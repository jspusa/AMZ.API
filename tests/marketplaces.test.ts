import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKETPLACE_ID,
  MARKETPLACES,
  marketplaceByCode,
  marketplaceById,
  marketplaceSelectLabel,
} from "../src/shared/marketplaces";
import { ACCOUNTING_MARKETPLACES } from "../src/main/amazon/accounting-capabilities";
import { REPORT_LIBRARY_MARKETPLACES } from "../src/main/amazon/report-library";
import { OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES } from "../src/main/amazon/replenishment-audit";
import {
  isMarketplaceId,
  MARKETPLACES as SP_API_MARKETPLACES,
} from "../src/main/amazon/sp-marketplaces";
import { isSubscriptionAuditMarketplaceSupported } from "../src/renderer/src/subscription-audit";

const EXPECTED_IDS = [
  "ATVPDKIKX0DER",
  "A1VC38T7YXB528",
  "A2EUQ1WTGCTBG2",
  "A19VAU5U5O7RUS",
  "A39IBJ37TRP1C6",
  "A1F83G8C2ARO7P",
  "A1PA6795UKMFR9",
] as const;

describe("shared marketplace metadata", () => {
  it("contains every supported marketplace exactly once with complete neutral metadata", () => {
    expect(MARKETPLACES.map((marketplace) => marketplace.id)).toEqual(EXPECTED_IDS);
    expect(new Set(MARKETPLACES.map((marketplace) => marketplace.id)).size).toBe(7);
    expect(new Set(MARKETPLACES.map((marketplace) => marketplace.code)).size).toBe(7);
    expect(DEFAULT_MARKETPLACE_ID).toBe("ATVPDKIKX0DER");

    for (const marketplace of MARKETPLACES) {
      expect(Object.keys(marketplace).sort()).toEqual([
        "code",
        "currency",
        "id",
        "label",
        "locale",
        "name",
        "region",
        "sampleSku",
        "shortLabel",
        "timeZone",
      ]);
      expect(marketplace.id).toMatch(/^[A-Z0-9]{10,16}$/u);
      expect(marketplace.currency).toMatch(/^[A-Z]{3}$/u);
      expect(marketplace.sampleSku.length).toBeGreaterThan(0);
      expect(marketplaceById(marketplace.id)).toBe(marketplace);
      expect(marketplaceByCode(marketplace.code)).toBe(marketplace);
      expect(marketplaceSelectLabel(marketplace)).toBe(
        `${marketplace.code} · ${marketplace.label}`,
      );
      expect(() =>
        new Intl.DateTimeFormat(marketplace.locale, {
          timeZone: marketplace.timeZone,
        }).format(new Date(0)),
      ).not.toThrow();
    }
  });

  it("keeps regional grouping in core metadata and domain qualification in its overlay", () => {
    expect(
      MARKETPLACES.filter((marketplace) => marketplace.region === "na").map(
        (marketplace) => marketplace.code,
      ),
    ).toEqual(["US", "CA"]);
    expect(
      MARKETPLACES.filter((marketplace) => marketplace.region === "fe").map(
        (marketplace) => marketplace.code,
      ),
    ).toEqual(["JP", "SG", "AU"]);
    expect(
      MARKETPLACES.filter((marketplace) => marketplace.region === "eu").map(
        (marketplace) => marketplace.code,
      ),
    ).toEqual(["UK", "DE"]);

    expect(
      isSubscriptionAuditMarketplaceSupported(marketplaceByCode("US").id),
    ).toBe(true);
    expect(
      isSubscriptionAuditMarketplaceSupported(marketplaceByCode("SG").id),
    ).toBe(false);
    expect(
      isSubscriptionAuditMarketplaceSupported(marketplaceByCode("AU").id),
    ).toBe(false);
  });

  it("derives main-process neutral fields without changing domain representations", () => {
    const accountingRegion = { na: "NA", fe: "FE", eu: "EU" } as const;
    for (const marketplace of MARKETPLACES) {
      expect(isMarketplaceId(marketplace.id)).toBe(true);
      expect(SP_API_MARKETPLACES[marketplace.id]).toEqual({
        label: marketplace.label.replace(/站$/u, ""),
        shortLabel: marketplace.shortLabel,
        name: marketplace.name,
        currency: marketplace.currency,
        region: marketplace.region,
        issueLocale: marketplace.locale.replace("-", "_"),
        timeZone: marketplace.timeZone,
      });
      expect(ACCOUNTING_MARKETPLACES[marketplace.id]).toEqual({
        code: marketplace.code,
        region: accountingRegion[marketplace.region],
      });
      expect(REPORT_LIBRARY_MARKETPLACES[marketplace.id]).toEqual({
        code: marketplace.code,
        label: marketplace.label.replace(/站$/u, ""),
      });
    }
    for (const inheritedName of ["constructor", "toString", "__proto__"]) {
      expect(isMarketplaceId(inheritedName)).toBe(false);
    }

    for (const supportedCode of ["US", "CA", "JP", "UK", "DE"] as const) {
      const marketplace = marketplaceByCode(supportedCode);
      expect(OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES[marketplace.id]).toBe(
        marketplace.currency,
      );
    }
    expect(
      Object.hasOwn(
        OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES,
        marketplaceByCode("SG").id,
      ),
    ).toBe(false);
    expect(OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES.A1RKKUPIHCS9HS).toBe("EUR");
  });

  it("keeps main domain overlays explicit while removing duplicated configured IDs", async () => {
    const mainFiles = {
      accounting: "../src/main/amazon/accounting-capabilities.ts",
      ads: "../src/main/amazon/ads-api.ts",
      replenishment: "../src/main/amazon/replenishment-audit.ts",
      inventory: "../src/main/amazon/fba-inventory-replenishment.ts",
      inventoryProduction:
        "../src/main/amazon/fba-inventory-replenishment-production.ts",
      reports: "../src/main/amazon/report-library.ts",
      customerFeedback: "../src/main/amazon/customer-feedback-reads.ts",
      customerFeedbackProduction:
        "../src/main/amazon/customer-feedback-reads-production.ts",
      demoFbaCatalog: "../src/main/amazon/demo-fba-catalog.ts",
      orders: "../src/main/amazon/orders-reads.ts",
      ordersProduction: "../src/main/amazon/orders-reads-production.ts",
      spMarketplaces: "../src/main/amazon/sp-marketplaces.ts",
      vault: "../src/main/credential-vault.ts",
    } as const;
    const sources = Object.fromEntries(await Promise.all(
      Object.entries(mainFiles).map(async ([name, path]) => [
        name,
        await readFile(new URL(path, import.meta.url), "utf8"),
      ]),
    )) as Record<keyof typeof mainFiles, string>;

    for (const source of Object.values(sources)) {
      expect(source).toContain("shared/marketplaces");
      for (const marketplaceId of EXPECTED_IDS) {
        expect(source).not.toContain(marketplaceId);
      }
    }
    expect(sources.ads).toContain('UK: "GB"');
    expect(sources.replenishment).toContain(
      "OTHER_OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES",
    );
    expect(sources.inventory).toContain(
      "OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES",
    );
    expect(sources.reports).toContain("CUSTOMER_FEEDBACK_STORES");
    expect(sources.customerFeedback).toContain(
      "customerFeedbackMarketplaceSupported",
    );
    expect(sources.customerFeedbackProduction).toContain(
      "customerFeedbackMarketplaceSupported",
    );
    const spApi = await readFile(
      new URL("../src/main/amazon/sp-api.ts", import.meta.url),
      "utf8",
    );
    expect(spApi).toContain('from "./sp-marketplaces"');
    expect(spApi).toContain("customerFeedbackPageAdapterProduction");
  });

  it("keeps renderer marketplace selectors dependent on the shared source", async () => {
    const rendererFiles = [
      "../src/renderer/src/components/ads-drawer.tsx",
      "../src/renderer/src/components/dashboard.tsx",
      "../src/renderer/src/components/image-workspace-drawer.tsx",
      "../src/renderer/src/components/price-drawer.tsx",
      "../src/renderer/src/components/promotion-center-drawer.tsx",
      "../src/renderer/src/components/replenishment-drawer.tsx",
      "../src/renderer/src/components/review-audit-panel.tsx",
      "../src/renderer/src/components/sku-command-center.tsx",
      "../src/renderer/src/components/sku-operations-drawer.tsx",
      "../src/renderer/src/components/variation-planner-drawer.tsx",
      "../src/renderer/src/connection-panel.tsx",
      "../src/renderer/src/subscription-audit.ts",
    ];
    const sources = await Promise.all(
      rendererFiles.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

    for (const source of sources) {
      expect(source).toContain("shared/marketplaces");
      for (const marketplaceId of EXPECTED_IDS) {
        expect(source).not.toContain(marketplaceId);
      }
    }
  });
});
