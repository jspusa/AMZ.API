import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { ContentAuditOwner } from "../src/main/amazon/content-audit-owner";
import type { CatalogExportRow } from "../src/main/amazon/catalog-report-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import {
  auditListingContentRows,
  type ContentQualitySourceRow,
} from "../src/main/amazon/content-quality";
import {
  parseContentAuditSnapshot,
  quickEditFocusForRow,
  resolveContentAuditQuickEditFocus,
} from "../src/renderer/src/components/content-audit-panel";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const FETCHED_AT = "2026-09-16T02:00:00.000Z";

function row(overrides: Partial<ContentQualitySourceRow> = {}): ContentQualitySourceRow {
  return {
    sellerSku: "GRAIN-CHECK",
    asin: "B000000123",
    productType: "PET_FOOD",
    title: "T".repeat(60),
    itemHighlight: "H".repeat(110),
    bulletPoints: ["A", "B", "C", "D", "E"].map((value) => value.repeat(150)),
    productDescription: "P".repeat(1_800),
    ingredients: "Turkey, Brown Rice",
    readStatus: "complete",
    readErrors: [],
    ...overrides,
  };
}

function audit(...rows: ContentQualitySourceRow[]) {
  return auditListingContentRows({ marketplaceId: MARKETPLACE_ID, fetchedAt: FETCHED_AT, rows });
}

function claimIssues(value: { issues: Array<{ kind: string }> }) {
  return value.issues.filter((issue) => issue.kind === "SINGLE_INGREDIENT_MISMATCH");
}

describe("grain-free content claim consistency", () => {
  it("reports title, highlight and exact bullet claims once each, excluding descriptions", () => {
    const source = row({
      title: `${"T".repeat(60)} Grain-Free grain free`,
      itemHighlight: `${"H".repeat(110)} GRAIN FREE`,
      bulletPoints: ["A".repeat(150), `${"B".repeat(150)} grain‑free`, ...row().bulletPoints.slice(2)],
      productDescription: `${"P".repeat(1_800)} Grain-Free single ingredient tendon hypoallergenic`,
      ingredients: "Turkey, Brown Rice, Chicken",
    });
    const original = structuredClone(source);
    const result = audit(source);

    expect(claimIssues(result.rows[0]!)).toEqual([
      expect.objectContaining({ field: "title", token: "Grain-Free", message: expect.stringContaining("Rice") }),
      expect.objectContaining({ field: "itemHighlight", token: "GRAIN FREE" }),
      expect.objectContaining({ field: "bulletPoints", bulletIndex: 1, token: "grain‑free" }),
    ]);
    expect(result.summary.singleIngredientMismatch).toBe(1);
    expect(source).toEqual(original);
  });

  it.each([
    "Wheat", "Brown Rice", "Brewers Rice", "Corn", "Maize", "Cornmeal",
    "Cornstarch", "Barley", "Oats", "Oatmeal", "Rye", "Millet", "Sorghum",
    "Triticale", "Bulgur", "Teff", "Natural flavor (rice flour, turkey)",
  ])("uses explicit grain evidence: %s", (ingredients) => {
    const result = audit(row({ title: `${"T".repeat(60)} grain free`, ingredients }));
    expect(claimIssues(result.rows[0]!)).toHaveLength(1);
  });

  it.each([
    "Turkey, Soy Protein, Peas, Lentils, Chickpeas, Potato, Tapioca Starch",
    "Turkey, Coconut Glycerin, Starch",
    "Turkey, Peppercorn, Licorice",
    "Turkey, no wheat, corn or rice",
    "Turkey; Free from rice and wheat",
    "Turkey, without corn",
    "Turkey; Does not contain rice",
    "Turkey, wheat-free, corn-free",
    "Turkey; rice and wheat free",
    "Turkey; May contain wheat",
    "",
  ])("does not infer a grain conflict from absent or unproven evidence: %s", (ingredients) => {
    const result = audit(row({ title: `${"T".repeat(60)} Grain-Free`, ingredients }));
    expect(claimIssues(result.rows[0]!)).toEqual([]);
  });

  it("retains positive rice evidence separately from a wheat exclusion", () => {
    const result = audit(row({
      title: `${"T".repeat(60)} Grain-Free`,
      ingredients: "Turkey; wheat-free; Brown Rice",
    }));
    expect(claimIssues(result.rows[0]!)).toEqual([
      expect.objectContaining({ message: expect.stringContaining("（Rice）") }),
    ]);
  });

  it.each(["Not grain-free", "Not a grain free food", "Never grain-free"])(
    "does not treat a negated claim as a positive grain-free claim: %s",
    (title) => expect(claimIssues(audit(row({ title })).rows[0]!)).toEqual([]),
  );

  it("does not evaluate descriptions or incomplete listing reads", () => {
    const result = audit(
      row({ productDescription: "Grain-Free single ingredient tendon hypoallergenic", ingredients: "Turkey, Rice, Chicken" }),
      row({ title: "Grain-Free", readStatus: "incomplete", readErrors: [{ code: "LISTING_QUERY_FAILED", message: "Read incomplete" }] }),
    );
    expect(result.rows.map(claimIssues)).toEqual([[], []]);
    expect(result.summary.singleIngredientMismatch).toBe(0);
  });

  it("keeps the main audit, renderer re-projection and quick-edit evidence aligned", () => {
    const source = row({ title: `${"T".repeat(60)} Grain-Free` });
    const main = audit(source);
    const renderer = parseContentAuditSnapshot(main, MARKETPLACE_ID);
    expect(claimIssues(renderer.rows[0]!)).toEqual(claimIssues(main.rows[0]!));
    expect(renderer.summary.singleIngredientMismatch).toBe(1);
    const focus = quickEditFocusForRow(renderer.rows[0]!);
    expect(focus).toMatchObject({
      fields: ["title"],
      evidence: [expect.objectContaining({ token: "Grain-Free", relatedIngredients: "Turkey, Brown Rice" })],
    });
    const fresh = {
      sellerSku: source.sellerSku,
      asin: source.asin,
      productType: source.productType,
      content: {
        title: source.title,
        itemHighlight: source.itemHighlight!,
        bulletPoints: source.bulletPoints,
        productDescription: source.productDescription!,
        ingredients: source.ingredients,
      },
    };
    expect(resolveContentAuditQuickEditFocus(focus!, fresh)).toMatchObject({ status: "focused" });
    expect(resolveContentAuditQuickEditFocus(focus!, {
      ...fresh,
      content: { ...fresh.content, ingredients: "Turkey, Peas" },
    })).toMatchObject({ status: "stale" });
    expect(resolveContentAuditQuickEditFocus(focus!, {
      ...fresh,
      content: { ...fresh.content, title: `${"T".repeat(60)} With Rice` },
    })).toMatchObject({ status: "stale" });
  });

  it("exports the same grain finding through the main-owned workbook", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "demo",
      accountScope: "a".repeat(64),
    }));
    const source: CatalogExportRow = {
      ...row(),
      title: `${"T".repeat(60)} Grain-Free`,
      itemHighlight: "H".repeat(110),
      productDescription: `${"P".repeat(1_800)} Grain-Free`,
      marketplace: "Amazon.com",
      imageUrls: [],
      status: "BUYABLE",
      updatedAt: FETCHED_AT,
    };
    const owner = new ContentAuditOwner({
      context,
      evidence: { saveContentAuditSnapshotEvidence: async () => ({
        createdAt: Date.parse(FETCHED_AT),
        expiresAt: Date.parse(FETCHED_AT) + 86_400_000,
      }) },
      now: () => Date.parse(FETCHED_AT),
      readGrouping: async () => ({
        marketplaceId: MARKETPLACE_ID,
        fetchedAt: FETCHED_AT,
        notice: "Fixture FBA relationship evidence",
        rows: [{
          ...source,
          role: "standalone",
          parentSku: null,
          familyKey: source.sellerSku,
          theme: null,
          status: "complete",
          message: "Verified standalone fixture",
        }],
      }),
    });
    const snapshot = await owner.captureFromListings({
      context: await context.capture(MARKETPLACE_ID),
      marketplaceId: MARKETPLACE_ID,
      listings: { fetchedAt: FETCHED_AT, errors: [], rows: [source] },
    });
    const finding = claimIssues(snapshot.rows[0]!);
    expect(finding).toEqual([
      expect.objectContaining({ field: "title", token: "Grain-Free" }),
    ]);
    const response = await owner.download({
      marketplaceId: MARKETPLACE_ID,
      exportId: snapshot.exportId,
      scope: "attention",
    });
    expect(response.status).toBe(200);
    if (response.body.kind !== "bytes") throw new Error("Expected workbook bytes");
    const xml = Object.entries(unzipSync(response.body.value))
      .filter(([name]) => name.endsWith(".xml"))
      .map(([, value]) => strFromU8(value)).join("\n");
    expect(xml).toContain("成分宣稱不一致 · 產品名稱");
    expect(xml).toContain("穀物或穀物來源成分（Rice）");
    expect(xml).not.toContain("成分宣稱不一致 · 產品敘述");
  });
});
