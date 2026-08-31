import { randomUUID } from "node:crypto";
import type { ApiResponse } from "../../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { addPagesDictionarySpellingIssues } from
  "../../shared/content-spelling-rules";
import { forwardAbort, throwIfAborted } from "../abort-utils";
import type {
  AuditSuiteRunControl,
  AuditSuiteSectionRunners,
} from "./audit-suite-coordinator";
import type { AuditSuiteContext } from "./audit-suite-context";
import type { AuditSuiteListingsResource } from "./audit-suite-resources";
import type {
  CatalogExportRow,
  FbaCatalogExport,
} from "./catalog-report-reads";
import {
  auditListingContentRows,
  summarizeContentQualityRows,
  type ContentQualityField,
  type ContentQualityIssue,
  type ContentQualityIssueKind,
  type ContentQualityRow,
} from "./content-quality";
import {
  contentAuditEvidenceRowDigest,
  type ContentAuditSnapshotEvidenceInput,
  type ContentAuditSnapshotEvidenceWriter,
} from "./content-audit-snapshot-evidence";
import { ContextBoundAuditSnapshotStore } from
  "./context-bound-audit-snapshot";
import { SpApiError } from "./sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import type { FbaVariationGroupingData } from
  "./variation-catalog-reads";
import {
  createContentAuditWorkbookV2,
  type ContentAuditWorkbookV2Row,
  type CreateContentAuditWorkbookV2Input,
  type WorkbookRichTextRun,
} from "./xlsx";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CONTENT_AUDIT_STANDALONE_FAMILY_KEY = "STANDALONE";
const CONTENT_AUDIT_INCOMPLETE_FAMILY_KEY = "DATA_INCOMPLETE";
const CONTENT_AUDIT_FALLBACK_RELATIONSHIP_MESSAGE =
  "Amazon relationships 未與文案列完整對齊；本列不會被猜入任一變體 family。";
const OPAQUE_EXPORT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INVISIBLE_CHARACTER = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu;

export const CONTENT_AUDIT_FULL_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
export const CONTENT_AUDIT_STANDALONE_TTL_MS = 30 * 60 * 1_000;

export type ContentAuditRelationship = Readonly<{
  variationRole: "parent" | "child" | "standalone" | "unknown";
  variationParentSku: string | null;
  variationFamilyKey: string | null;
  variationTheme: string | null;
  relationshipStatus: "complete" | "incomplete";
  relationshipMessage: string | null;
}>;

export type ContentAuditRow = ContentQualityRow & ContentAuditRelationship;

export type ContentAuditSnapshot = Readonly<{
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  exportId: string;
  rows: ContentAuditRow[];
  readErrors: Array<{
    sellerSku: string;
    code: "LISTING_QUERY_FAILED" | "LISTING_CONTENT_NOT_RETURNED";
    message: string;
  }>;
  summary: ReturnType<typeof auditListingContentRows>["summary"];
}>;

export type ContentAuditEvidenceInput = ContentAuditSnapshotEvidenceInput;
export type ContentAuditEvidencePort = ContentAuditSnapshotEvidenceWriter;

type ContentAuditProjectionInput = Readonly<{
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  listings: FbaCatalogExport;
  grouping: FbaVariationGroupingData<CatalogExportRow>;
  signal?: AbortSignal;
}>;

export type ContentAuditListingsInput = Readonly<{
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  listings: FbaCatalogExport;
  signal?: AbortSignal;
  onGroupingProgress?: (progress: Readonly<{
    completedBatches: number;
    totalBatches: number;
  }>) => void | Promise<void>;
}>;

export type ContentAuditGroupingReader = (input: Readonly<{
  marketplaceId: MarketplaceId;
  rows: readonly CatalogExportRow[];
  signal: AbortSignal;
  onProgress?: ContentAuditListingsInput["onGroupingProgress"];
}>) => Promise<FbaVariationGroupingData<CatalogExportRow>>;

export type ContentAuditWorkbookScope = "attention" | "all";

export interface ContentAuditOwnerPort {
  runAuditSuite(input: Readonly<{
    context: AuditSuiteContext;
    control: AuditSuiteRunControl;
    listings: AuditSuiteListingsResource;
  }>): ReturnType<AuditSuiteSectionRunners["content"]>;
  captureFromListings(
    input: ContentAuditListingsInput,
  ): Promise<ContentAuditSnapshot>;
  captureStandaloneFromListings(
    input: ContentAuditListingsInput,
  ): Promise<ContentAuditSnapshot>;
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<ContentAuditSnapshot>;
  download(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
    scope: ContentAuditWorkbookScope;
  }>): Promise<ApiResponse>;
  clear(): void;
}

export type ContentAuditOwnerInput = Readonly<{
  context: SpExecutionContextAdapter;
  evidence: ContentAuditEvidencePort;
  createWorkbook?: (
    input: CreateContentAuditWorkbookV2Input,
  ) => Uint8Array;
  ttlMs?: number;
  standaloneTtlMs?: number;
  readGrouping: ContentAuditGroupingReader;
  now?: () => number;
  createId?: () => string;
}>;

type ContentAuditWorkbookFinding = Readonly<{
  type: string;
  description: string;
}>;

type InvisibleCharacterLocation = Readonly<{
  field: ContentQualityField;
  fieldLabel: string;
  codePoint: string;
  name: string;
  context: string;
  before: string;
  after: string;
}>;

type HighlightRange = Readonly<{
  start: number;
  end: number;
  token: string;
  replacement?: string;
}>;

const INVISIBLE_CHARACTER_NAMES: Readonly<Record<string, string>> = {
  "U+200B": "零寬空格",
  "U+200C": "零寬非連接符",
  "U+200D": "零寬連接符",
  "U+200E": "左至右標記",
  "U+200F": "右至左標記",
  "U+202A": "左至右嵌入",
  "U+202B": "右至左嵌入",
  "U+202C": "彈出方向格式",
  "U+202D": "左至右覆寫",
  "U+202E": "右至左覆寫",
  "U+2060": "單字連接符",
  "U+FEFF": "零寬不換行空格／BOM",
};

function bytes(
  value: Uint8Array,
  headers: Record<string, string>,
): ApiResponse {
  return {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": XLSX_CONTENT_TYPE,
      "x-content-type-options": "nosniff",
      ...headers,
    },
    body: { kind: "bytes", value },
  };
}

function snapshotDate(fetchedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/u.exec(fetchedAt);
  if (!match || !Number.isFinite(Date.parse(fetchedAt))) {
    throw new Error("Content audit snapshot time is invalid.");
  }
  const normalized = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ));
  if (
    normalized.getUTCFullYear() !== Number(match[1]) ||
    normalized.getUTCMonth() !== Number(match[2]) - 1 ||
    normalized.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("Content audit snapshot time is invalid.");
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function contentAuditWorkbookFamilyKey(row: ContentAuditRow): string {
  if (row.variationRole === "standalone" && row.relationshipStatus === "complete") {
    return CONTENT_AUDIT_STANDALONE_FAMILY_KEY;
  }
  if (
    row.variationRole === "child" &&
    row.relationshipStatus === "complete" &&
    row.variationFamilyKey
  ) {
    return row.variationFamilyKey;
  }
  return CONTENT_AUDIT_INCOMPLETE_FAMILY_KEY;
}

function issueLabel(kind: ContentQualityIssueKind): string {
  if (kind === "MISSING_BULLETS") return "賣點不足";
  if (kind === "MISSING_INGREDIENTS") return "缺成分";
  if (kind === "INGREDIENTS_UNVERIFIED") return "成分未驗證";
  if (kind === "TITLE_BELOW_TARGET") return "產品名稱過短";
  if (kind === "HIGHLIGHT_BELOW_TARGET") return "產品亮點過短";
  if (kind === "BULLET_BELOW_TARGET") return "產品要點過短";
  if (kind === "BULLET_ABOVE_TARGET") return "產品要點過長";
  if (kind === "DESCRIPTION_BELOW_TARGET") return "產品敘述過短";
  if (kind === "SINGLE_INGREDIENT_MISMATCH") return "成分宣稱不一致";
  return "疑似錯字";
}

function fieldLabel(field: ContentQualityField): string {
  if (field === "title") return "產品名稱";
  if (field === "itemHighlight") return "產品亮點";
  if (field === "productDescription") return "產品敘述";
  if (field === "ingredients") return "成分";
  return "產品要點";
}

function codePointLabel(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0")}`;
}

function isInvisibleCharacterIssue(issue: ContentQualityIssue): boolean {
  return /^U\+[0-9A-F]{4,6}$/iu.test(issue.token ?? "");
}

function visibleInvisibleCharacters(value: string): string {
  return value.replace(INVISIBLE_CHARACTER, (character) => {
    const codePoint = codePointLabel(character);
    return `⟦${codePoint} ${
      INVISIBLE_CHARACTER_NAMES[codePoint] ?? "不可見字元"
    }⟧`;
  });
}

function adjacentToken(value: string, direction: "before" | "after"): string {
  if (direction === "before") {
    const match = value.trimEnd().match(/([\p{L}\p{N}’'\-]+|[^\s])$/u);
    return match?.[1] ?? "前方文字";
  }
  const match = value.trimStart().match(/^([\p{L}\p{N}’'\-]+|[^\s])/u);
  return match?.[1] ?? "後方文字";
}

function invisibleLocationsInValue(
  field: ContentQualityField,
  fieldName: string,
  value: string,
  expectedCodePoints: ReadonlySet<string>,
): InvisibleCharacterLocation[] {
  const locations: InvisibleCharacterLocation[] = [];
  for (const match of value.matchAll(INVISIBLE_CHARACTER)) {
    const character = match[0];
    const index = match.index;
    const codePoint = codePointLabel(character);
    if (!expectedCodePoints.has(codePoint)) continue;
    const start = Math.max(0, index - 36);
    const end = Math.min(value.length, index + character.length + 36);
    locations.push({
      field,
      fieldLabel: fieldName,
      codePoint,
      name: INVISIBLE_CHARACTER_NAMES[codePoint] ?? "不可見字元",
      context: `${start > 0 ? "…" : ""}${visibleInvisibleCharacters(
        value.slice(start, end),
      ).replaceAll("\n", " ↵ ")}${end < value.length ? "…" : ""}`,
      before: adjacentToken(value.slice(0, index), "before"),
      after: adjacentToken(value.slice(index + character.length), "after"),
    });
  }
  return locations;
}

function locateInvisibleCharacters(row: ContentAuditRow): InvisibleCharacterLocation[] {
  if (row.readStatus !== "complete") return [];
  const expectedCodePoints = new Set(
    row.issues
      .filter(isInvisibleCharacterIssue)
      .map((issue) => issue.token?.toUpperCase())
      .filter((token): token is string => Boolean(token)),
  );
  if (!expectedCodePoints.size) return [];
  return [
    ...invisibleLocationsInValue(
      "title",
      "商品標題",
      row.title,
      expectedCodePoints,
    ),
    ...invisibleLocationsInValue(
      "itemHighlight",
      "產品亮點",
      row.itemHighlight,
      expectedCodePoints,
    ),
    ...row.bulletPoints.flatMap((bulletPoint, index) =>
      invisibleLocationsInValue(
        "bulletPoints",
        `賣點 ${index + 1}`,
        bulletPoint,
        expectedCodePoints,
      )),
    ...invisibleLocationsInValue(
      "productDescription",
      "產品敘述",
      row.productDescription,
      expectedCodePoints,
    ),
    ...invisibleLocationsInValue(
      "ingredients",
      "成分",
      row.ingredients,
      expectedCodePoints,
    ),
  ];
}

function issueHighlightRanges(
  value: string,
  issues: readonly ContentQualityIssue[],
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const loweredValue = value.toLocaleLowerCase("en-US");
  for (const issue of issues) {
    if (issue.kind !== "SUSPECTED_TYPO" || !issue.token) continue;
    if (isInvisibleCharacterIssue(issue)) {
      const numeric = Number.parseInt(issue.token.slice(2), 16);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) continue;
      const character = String.fromCodePoint(numeric);
      let index = value.indexOf(character);
      while (index >= 0 && ranges.length < 60) {
        const codePoint = issue.token.toUpperCase();
        ranges.push({
          start: index,
          end: index + character.length,
          token: codePoint,
          replacement: `⟦${codePoint} ${
            INVISIBLE_CHARACTER_NAMES[codePoint] ?? "不可見字元"
          }⟧`,
        });
        index = value.indexOf(character, index + character.length);
      }
      continue;
    }
    const loweredToken = issue.token.toLocaleLowerCase("en-US");
    let index = loweredValue.indexOf(loweredToken);
    while (index >= 0 && ranges.length < 60) {
      const end = index + issue.token.length;
      const previous = index > 0 ? value[index - 1] : "";
      const next = end < value.length ? value[end] : "";
      const wordCharacter = /[A-Za-z'\u2019]/u;
      if (!wordCharacter.test(previous) && !wordCharacter.test(next)) {
        ranges.push({ start: index, end, token: issue.token });
      }
      index = loweredValue.indexOf(loweredToken, index + issue.token.length);
    }
  }
  const accepted: HighlightRange[] = [];
  for (const range of ranges.sort((left, right) =>
    left.start - right.start || right.end - left.end)) {
    if (accepted.some((current) =>
      range.start < current.end && range.end > current.start)) continue;
    accepted.push(range);
  }
  return accepted;
}

function auditRichTextRuns(
  value: string,
  row: ContentAuditRow,
  field: ContentQualityField,
  bulletIndex?: number,
): WorkbookRichTextRun[] {
  const issues = row.issues.filter((issue) =>
    issue.kind === "SUSPECTED_TYPO" &&
    issue.field === field &&
    (field !== "bulletPoints" ||
      issue.bulletIndex === undefined ||
      issue.bulletIndex === bulletIndex));
  const ranges = issueHighlightRanges(value, issues);
  if (!ranges.length) return [{ text: value, alert: false }];
  const runs: WorkbookRichTextRun[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      runs.push({ text: value.slice(cursor, range.start), alert: false });
    }
    runs.push({
      text: range.replacement ?? value.slice(range.start, range.end),
      alert: true,
    });
    cursor = range.end;
  }
  if (cursor < value.length) {
    runs.push({ text: value.slice(cursor), alert: false });
  }
  return runs;
}

function auditFindings(row: ContentAuditRow): ContentAuditWorkbookFinding[] {
  const invisibleLocations = locateInvisibleCharacters(row);
  const locatedInvisibleIssues = new Set(
    invisibleLocations.map((location) =>
      `${location.field}:${location.codePoint}`),
  );
  return [
    ...row.readErrors.map((readError) => ({
      type: "讀取未完成",
      description: readError.message,
    })),
    ...row.issues
      .filter((issue) =>
        !isInvisibleCharacterIssue(issue) ||
        !locatedInvisibleIssues.has(
          `${issue.field}:${issue.token?.toUpperCase() ?? ""}`,
        ))
      .map((issue) => ({
        type: `${issueLabel(issue.kind)} · ${fieldLabel(issue.field)}`,
        description: `${issue.message}${
          issue.suggestion && !issue.message.includes(issue.suggestion)
            ? ` 建議檢查：${issue.suggestion}`
            : ""
        }`,
      })),
    ...invisibleLocations.map((location) => ({
      type: `不可見字元 · ${location.fieldLabel}`,
      description:
        `${location.codePoint}（${location.name}）位於「${location.before}」與「${location.after}」之間：${location.context}。應手動修改此段。`,
    })),
  ];
}

function workbookRow(row: ContentAuditRow): ContentAuditWorkbookV2Row {
  const findings = auditFindings(row);
  const bulletRuns = Array.from({ length: 5 }, (_, index) =>
    auditRichTextRuns(
      row.bulletPoints[index] ?? "",
      row,
      "bulletPoints",
      index,
    ));
  return {
    sellerSku: row.sellerSku,
    asin: row.asin,
    productType: row.productType,
    title: row.title,
    itemHighlight: row.itemHighlight,
    bulletPoints: row.bulletPoints,
    productDescription: row.productDescription,
    ingredients: row.ingredients,
    variationRole: row.variationRole,
    variationParentSku: row.variationParentSku ?? "",
    variationFamilyKey: row.variationFamilyKey ?? "",
    variationTheme: row.variationTheme ?? "",
    issueFields: {
      title: row.issues.some((issue) => issue.field === "title"),
      itemHighlight: row.issues.some((issue) => issue.field === "itemHighlight"),
      bulletPoints: Array.from({ length: 5 }, (_, index) =>
        row.issues.some((issue) => {
          if (issue.field !== "bulletPoints") return false;
          if (issue.bulletIndex !== undefined) return issue.bulletIndex === index;
          if (issue.kind === "SUSPECTED_TYPO") {
            return bulletRuns[index]?.some((run) => run.alert) ?? false;
          }
          return true;
        })),
      productDescription: row.issues.some(
        (issue) => issue.field === "productDescription",
      ),
      ingredients: row.issues.some((issue) => issue.field === "ingredients"),
    },
    auditTitleRuns: auditRichTextRuns(row.title, row, "title"),
    auditItemHighlightRuns: auditRichTextRuns(
      row.itemHighlight,
      row,
      "itemHighlight",
    ),
    auditBulletPointRuns: bulletRuns,
    auditProductDescriptionRuns: auditRichTextRuns(
      row.productDescription,
      row,
      "productDescription",
    ),
    auditIngredientsRuns: auditRichTextRuns(
      row.ingredients,
      row,
      "ingredients",
    ),
    auditType: [...new Set(findings.map((finding) => finding.type))].join("、"),
    auditDescription: findings
      .map((finding) => `[${finding.type}] ${finding.description}`)
      .join("\n"),
  };
}

/**
 * Complete owner of a content audit's projection, durable digest evidence,
 * short-lived full snapshot, and round-trip workbook. Callers supply one
 * already captured SP context plus listings; this owner acquires grouping
 * through its fixed semantic reader under the same clearable lifecycle.
 */
export class ContentAuditOwner implements ContentAuditOwnerPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly evidence: ContentAuditEvidencePort;
  private readonly createWorkbook: (
    input: CreateContentAuditWorkbookV2Input,
  ) => Uint8Array;
  private readonly createId: () => string;
  private readonly standaloneTtlMs: number;
  private readonly readGrouping: ContentAuditGroupingReader;
  private readonly snapshots: ContextBoundAuditSnapshotStore<ContentAuditSnapshot>;
  private readonly controls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: ContentAuditOwnerInput) {
    this.context = input.context;
    this.evidence = input.evidence;
    this.createWorkbook = input.createWorkbook ?? createContentAuditWorkbookV2;
    this.createId = input.createId ?? randomUUID;
    this.readGrouping = input.readGrouping;
    this.standaloneTtlMs = input.standaloneTtlMs ??
      CONTENT_AUDIT_STANDALONE_TTL_MS;
    if (!Number.isSafeInteger(this.standaloneTtlMs) || this.standaloneTtlMs < 1) {
      throw new Error("Content audit retention must be a positive integer.");
    }
    this.snapshots = new ContextBoundAuditSnapshotStore({
      context: input.context,
      ttlMs: input.ttlMs ?? CONTENT_AUDIT_FULL_SNAPSHOT_TTL_MS,
      now: input.now,
      expiredMessage: "文案健檢快照已過期或站點不符，請重新掃描。",
    });
  }

  async runAuditSuite(
    input: Parameters<ContentAuditOwnerPort["runAuditSuite"]>[0],
  ): ReturnType<AuditSuiteSectionRunners["content"]> {
    const revision = this.lifecycleRevision;
    const operation = new AbortController();
    const unlinkCaller = forwardAbort(operation, input.control.signal);
    this.controls.add(operation);
    try {
      throwIfAborted(operation.signal);
      this.assertLifecycleCurrent(revision);
      const audit = auditListingContentRows({
        marketplaceId: input.context.marketplaceId,
        fetchedAt: input.listings.data.fetchedAt,
        rows: input.listings.data.rows,
      });
      const rows = audit.rows.flatMap((row) =>
        row.issues.map((issue) => ({
          sellerSku: row.sellerSku,
          title: row.title,
          asin: row.asin,
          problemType: issue.kind === "SUSPECTED_TYPO"
            ? "疑似錯字"
            : issue.message,
          field: fieldLabel(issue.field),
          originalText: issue.field === "title"
            ? row.title
            : issue.field === "itemHighlight"
              ? row.itemHighlight
              : issue.field === "bulletPoints"
                ? issue.bulletIndex === undefined
                  ? row.bulletPoints.join("\n")
                  : row.bulletPoints[issue.bulletIndex] ?? ""
                : issue.field === "productDescription"
                  ? row.productDescription
                  : row.ingredients,
          description: issue.suggestion
            ? `${issue.message} 建議：${issue.suggestion}`
            : issue.message,
        }))
      );
      throwIfAborted(operation.signal);
      this.assertLifecycleCurrent(revision);
      const scopeNotice = audit.summary.incomplete
        ? `另有 ${audit.summary.incomplete} 個 SKU 文案讀取未完成；未知不視為無問題。`
        : "Amazon 基礎文案欄位已完成讀取。";
      return {
        ...input.context,
        status: "partial",
        fetchedAt: audit.fetchedAt,
        notice: `${scopeNotice} 本機字典錯字結果需個別文案健檢補充`,
        payload: rows,
      };
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      this.assertLifecycleCurrent(revision);
      throwIfAborted(operation.signal);
      throw error;
    } finally {
      unlinkCaller();
      this.controls.delete(operation);
    }
  }

  async captureFromListings(
    input: ContentAuditListingsInput,
  ): Promise<ContentAuditSnapshot> {
    return this.captureFromListingsWithRetention(input);
  }

  async captureStandaloneFromListings(
    input: ContentAuditListingsInput,
  ): Promise<ContentAuditSnapshot> {
    return this.captureFromListingsWithRetention(
      input,
      this.standaloneTtlMs,
    );
  }

  private async captureFromListingsWithRetention(
    input: ContentAuditListingsInput,
    retentionMs?: number,
  ): Promise<ContentAuditSnapshot> {
    const revision = this.lifecycleRevision;
    const control = new AbortController();
    const unlinkCaller = forwardAbort(control, input.signal);
    this.controls.add(control);
    try {
      throwIfAborted(control.signal);
      if (input.context.marketplaceId !== input.marketplaceId) {
        throw this.contextInvalidated();
      }
      await this.context.assertCurrent(input.context);
      this.assertLifecycleCurrent(revision);
      const grouping = await this.readGrouping({
        marketplaceId: input.marketplaceId,
        rows: input.listings.rows,
        signal: control.signal,
        onProgress: input.onGroupingProgress,
      });
      throwIfAborted(control.signal);
      this.assertLifecycleCurrent(revision);
      return await this.captureWithRetention({
        context: input.context,
        marketplaceId: input.marketplaceId,
        listings: input.listings,
        grouping,
        signal: control.signal,
      }, retentionMs, revision);
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      await this.context.assertCurrent(input.context);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      throw error;
    } finally {
      unlinkCaller();
      this.controls.delete(control);
    }
  }

  private async captureWithRetention(
    input: ContentAuditProjectionInput,
    retentionMs?: number,
    expectedRevision = this.lifecycleRevision,
  ): Promise<ContentAuditSnapshot> {
    const revision = expectedRevision;
    throwIfAborted(input.signal);
    this.assertSourceIdentity(input);
    await this.context.assertCurrent(input.context);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(input.signal);

    const groupingBySku = new Map(
      input.grouping.rows.map((row) => [row.sellerSku, row] as const),
    );
    const audit = auditListingContentRows({
      marketplaceId: input.marketplaceId,
      fetchedAt: input.listings.fetchedAt,
      rows: input.grouping.rows.filter((row) => row.role !== "parent"),
    });
    const exportId = this.createId();
    if (!OPAQUE_EXPORT_ID.test(exportId)) {
      throw new Error("Content audit export capability is invalid.");
    }
    const baseSnapshot: ContentAuditSnapshot = {
      ...audit,
      marketplaceId: input.marketplaceId,
      exportId,
      rows: audit.rows.map((row): ContentAuditRow => {
        const relationship = groupingBySku.get(row.sellerSku);
        return {
          ...row,
          variationRole: relationship?.role ?? "unknown",
          variationParentSku: relationship?.parentSku ?? null,
          variationFamilyKey: relationship?.familyKey ?? row.sellerSku,
          variationTheme: relationship?.theme ?? null,
          relationshipStatus: relationship?.status ?? "incomplete",
          relationshipMessage: relationship?.message ??
            CONTENT_AUDIT_FALLBACK_RELATIONSHIP_MESSAGE,
        };
      }),
    };
    const rows = addPagesDictionarySpellingIssues(
      baseSnapshot.rows,
    );
    const snapshot: ContentAuditSnapshot = {
      ...baseSnapshot,
      rows,
      summary: summarizeContentQualityRows(rows),
    };
    const rowDigests = snapshot.rows.map((row) =>
      contentAuditEvidenceRowDigest({
        accountScope: input.context.accountScope,
        marketplaceId: input.marketplaceId,
        mode: input.context.mode,
        exportId,
        fetchedAt: snapshot.fetchedAt,
        sellerSku: row.sellerSku,
        asin: row.asin,
        productType: row.productType,
        variationFamilyKey: contentAuditWorkbookFamilyKey(row),
        values: {
          title: row.title,
          itemHighlight: row.itemHighlight,
          bulletPoints: Array.from(
            { length: 5 },
            (_value, index) => row.bulletPoints[index] ?? "",
          ),
          productDescription: row.productDescription,
          ingredients: row.ingredients,
        },
        readStatus: row.readStatus,
      }));

    await this.evidence.saveContentAuditSnapshotEvidence({
      exportId,
      marketplaceId: input.marketplaceId,
      accountScope: input.context.accountScope,
      mode: input.context.mode,
      fetchedAt: snapshot.fetchedAt,
      rowDigests,
    });
    throwIfAborted(input.signal);
    await this.context.assertCurrent(input.context);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(input.signal);
    this.snapshots.publish({
      context: input.context,
      marketplaceId: input.marketplaceId,
      snapshotId: exportId,
      snapshot,
      ttlMs: retentionMs,
    });
    return structuredClone(snapshot);
  }

  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<ContentAuditSnapshot> {
    return this.snapshots.read({
      marketplaceId: input.marketplaceId,
      snapshotId: input.exportId,
    });
  }

  async download(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
    scope: ContentAuditWorkbookScope;
  }>): Promise<ApiResponse> {
    const snapshot = await this.read(input);
    const marketplace = marketplaceById(input.marketplaceId);
    if (!marketplace) throw new Error("Amazon marketplace is unsupported.");
    const attentionRows = snapshot.rows.filter((row) =>
      row.readStatus === "incomplete" || row.issues.length > 0);
    const exportRows = input.scope === "all" ? snapshot.rows : attentionRows;
    const workbook = this.createWorkbook({
      marketplaceId: input.marketplaceId,
      marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
      exportId: snapshot.exportId,
      fetchedAt: snapshot.fetchedAt,
      rows: exportRows.map(workbookRow),
    });
    const date = snapshotDate(snapshot.fetchedAt);
    const filename = input.scope === "all"
      ? `amazon-fba-all-product-content-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`
      : `amazon-fba-content-audit-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
    const localizedFilename = input.scope === "all"
      ? `FBA-全部商品文案-${marketplace.shortLabel}-${date}.xlsx`
      : `FBA-文案健檢-${marketplace.shortLabel}-${date}.xlsx`;
    return bytes(workbook, {
      "content-disposition":
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`,
      "x-exported-fba-sku-count": String(exportRows.length),
      "x-content-audit-export-scope": input.scope,
      "x-content-audit-incomplete-count": String(snapshot.summary.incomplete),
      "x-content-audit-with-issues-count": String(snapshot.summary.withIssues),
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    const reason = this.contextInvalidated();
    for (const control of this.controls) control.abort(reason);
    this.controls.clear();
    this.snapshots.clear();
  }

  private contextInvalidated(): SpExecutionContextError {
    return new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  private assertSourceIdentity(input: ContentAuditProjectionInput): void {
    if (
      input.context.marketplaceId !== input.marketplaceId ||
      input.grouping.marketplaceId !== input.marketplaceId
    ) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    const listingSellerSkus = new Set(
      input.listings.rows.map((row) => row.sellerSku),
    );
    const groupingSellerSkus = new Set(
      input.grouping.rows.map((row) => row.sellerSku),
    );
    if (
      listingSellerSkus.size !== input.listings.rows.length ||
      groupingSellerSkus.size !== input.grouping.rows.length ||
      listingSellerSkus.size !== groupingSellerSkus.size ||
      ![...listingSellerSkus].every((sellerSku) =>
        groupingSellerSkus.has(sellerSku))
    ) {
      throw new SpApiError("FBA Listing 與 relationships SKU 範圍不一致。", {
        status: 409,
        code: "SNAPSHOT_INVALID",
      });
    }
  }

  private assertLifecycleCurrent(expected: number): void {
    if (this.lifecycleRevision === expected) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }
}
