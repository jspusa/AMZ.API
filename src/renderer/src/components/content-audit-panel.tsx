"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONTENT_AUDIT_LENGTH_TARGETS,
  contentHighlightSegments,
  isInvisibleCharacterIssue,
  locateInvisibleCharacters,
  summarizeContentAudit,
  trimmedUnicodeLength,
  type ContentAuditIssue,
  type ContentAuditIssueKind,
  type ContentAuditField,
  type ContentAuditReadError,
  type ContentAuditRow,
  type ContentAuditSnapshot,
} from "../content-quality";
import {
  contentAuditAttentionRows,
} from "../content-audit-excel";
import { auditExportFilename } from "../audit-export-filename";
import { downloadApiWorkbookResponse } from "../api-workbook-download";
import {
  pollStandaloneAuditJob,
  shouldResumeStandaloneAuditJob,
  startStandaloneAuditJob,
  standaloneAuditReconnectRevision,
  standaloneAuditSnapshotMatchesJob,
  type StandaloneAuditJob,
  type StandaloneAuditMode,
} from "../standalone-audit";
import {
  contentClaimFindings,
  contentClaimTokens,
  provenIngredientItems,
} from "../../../shared/content-claims";
import AuditDetailsDisclosure from "./audit-details-disclosure";

type ApiProblem = {
  code?: string;
  message?: string;
  requestId?: string | null;
};

type ContentWorkbookValues = {
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
};

type ContentWorkbookBatchIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
  categories?: string[];
  marketplaceIds?: string[];
};

type ContentWorkbookExactBulletReplacement = {
  languageTag: string;
  currentExactLanguageBulletPoints: string[];
  requestedExactLanguageBulletPoints: string[];
  removedOverflowBulletPoints: string[];
};

export type ContentWorkbookBlockedChange = {
  sellerSku: string;
  code: "CONTENT_READ_INCOMPLETE";
  message: string;
  changedFields: ContentAuditField[];
  previous: ContentWorkbookValues;
  requested: ContentWorkbookValues;
};

export type ContentWorkbookSkippedRow = {
  sellerSku: string | null;
  sourceSheet: string | null;
  rowNumber: number | null;
  stage: "WORKBOOK" | "SOURCE_CHECK" | "LOCAL_VALIDATION" | "AMAZON_PREVIEW";
  code: string;
  fields: string[];
  message: string;
};

export type ContentWorkbookBatchPreview = {
  previewId: string;
  marketplaceId: string;
  expiresAt: string;
  status: "READY";
  changes: Array<{
    sellerSku: string;
    changedFields: ContentAuditField[];
    previous: ContentWorkbookValues;
    requested: ContentWorkbookValues;
    exactBulletReplacement: ContentWorkbookExactBulletReplacement | null;
    issues: ContentWorkbookBatchIssue[];
    validationStatus: "VALID" | "SIMULATED";
    overrideAllowed: false;
  }>;
  blockedChanges: ContentWorkbookBlockedChange[];
  skippedRows: ContentWorkbookSkippedRow[];
  validationFailures: ContentWorkbookBatchFailure["rows"];
  validationOverride: {
    required: boolean;
    sellerSkus: string[];
  };
  notice: string;
};

export type ContentWorkbookBatchFailure = {
  code: "CONTENT_BATCH_VALIDATION_FAILED";
  message: string;
  writeCount: 0;
  rows: Array<{
    sellerSku: string;
    code: string;
    message: string;
    requestId: string | null;
    changedFields: ContentAuditField[];
    previous: ContentWorkbookValues;
    requested: ContentWorkbookValues;
    issues: ContentWorkbookBatchIssue[];
    overrideAllowed: boolean;
  }>;
  blockedChanges: ContentWorkbookBlockedChange[];
  skippedRows: ContentWorkbookSkippedRow[];
};

export type ContentWorkbookBatchBlockedFailure = {
  code: "CONTENT_READ_INCOMPLETE";
  message: string;
  writeCount: 0;
  blockedChanges: ContentWorkbookBlockedChange[];
};

export type ContentWorkbookBatchAllSkippedFailure = {
  code: "CONTENT_BATCH_ALL_SKIPPED";
  message: string;
  writeCount: 0;
  skippedRows: ContentWorkbookSkippedRow[];
  blockedChanges: ContentWorkbookBlockedChange[];
};

const CONTENT_WORKBOOK_FIELDS: readonly ContentAuditField[] = [
  "title",
  "itemHighlight",
  "bulletPoints",
  "productDescription",
  "ingredients",
];

const CONTENT_AUDIT_FIELDS = new Set<ContentAuditField>(CONTENT_WORKBOOK_FIELDS);

export type ContentWorkbookBatchResult = {
  previewId: string;
  marketplaceId: string;
  status:
    | "COMPLETED"
    | "COMPLETED_WITH_ISSUES"
    | "STOPPED_REJECTED"
    | "STOPPED_UNKNOWN";
  rows: Array<{
    sellerSku: string;
    state: "verified" | "simulated" | "rejected" | "unknown" | "not-started";
    error: { message: string; requestId?: string | null } | null;
  }>;
  blockedChanges: ContentWorkbookBlockedChange[];
  skippedRows: ContentWorkbookSkippedRow[];
  validationFailures: ContentWorkbookBatchFailure["rows"];
  notice: string;
};

type ReportReply = {
  ready: boolean;
  reportId: string | null;
  documentId: string | null;
  status: string | null;
  progress: number | null;
  message: string | null;
};

type AuditState = "idle" | "starting" | "polling" | "scanning" | "done";
export type AuditFilter =
  | "all"
  | "NEEDS_CORRECTION"
  | "CORRECT"
  | "READ_INCOMPLETE"
  | ContentAuditIssueKind;

const CONTENT_AUDIT_NEEDS_CORRECTION_KINDS = new Set<ContentAuditIssueKind>([
  "MISSING_BULLETS",
  "TITLE_BELOW_TARGET",
  "HIGHLIGHT_BELOW_TARGET",
  "BULLET_BELOW_TARGET",
  "BULLET_ABOVE_TARGET",
  "DESCRIPTION_BELOW_TARGET",
]);

const CONTENT_AUDIT_SPECIALIST_KINDS = new Set<ContentAuditIssueKind>([
  "SUSPECTED_TYPO",
  "MISSING_INGREDIENTS",
  "SINGLE_INGREDIENT_MISMATCH",
  "INGREDIENTS_UNVERIFIED",
]);

function contentAuditNeedsCorrection(row: ContentAuditRow): boolean {
  if (row.readStatus !== "complete") return false;
  if (row.issues.some((issue) => CONTENT_AUDIT_SPECIALIST_KINDS.has(issue.kind))) {
    return false;
  }
  return row.issues.some((issue) =>
    CONTENT_AUDIT_NEEDS_CORRECTION_KINDS.has(issue.kind));
}

function contentAuditReadIncomplete(row: ContentAuditRow): boolean {
  return row.readStatus === "incomplete" || row.issues.some(
    (issue) => issue.kind === "INGREDIENTS_UNVERIFIED",
  );
}

function contentAuditRowMatchesFilter(
  row: ContentAuditRow,
  filter: AuditFilter,
): boolean {
  if (filter === "all") {
    return row.readStatus === "incomplete" || row.issues.length > 0;
  }
  if (filter === "NEEDS_CORRECTION") return contentAuditNeedsCorrection(row);
  if (filter === "CORRECT") {
    return row.readStatus === "complete" && row.issues.length === 0;
  }
  if (filter === "READ_INCOMPLETE") return contentAuditReadIncomplete(row);
  return row.readStatus === "complete" && row.issues.some(
    (issue) => issue.kind === filter,
  );
}

function contentAuditIssueMatchesFilter(
  issue: ContentAuditIssue,
  filter: AuditFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "NEEDS_CORRECTION") {
    return CONTENT_AUDIT_NEEDS_CORRECTION_KINDS.has(issue.kind);
  }
  if (filter === "READ_INCOMPLETE") {
    return issue.kind === "INGREDIENTS_UNVERIFIED";
  }
  return filter !== "CORRECT" && issue.kind === filter;
}

export type ContentAuditCache = {
  snapshot: ContentAuditSnapshot;
  filter: AuditFilter;
  query: string;
  spellcheckNote: string | null;
};

export type ContentAuditQuickEditEvidence = {
  issueKind: ContentAuditIssueKind;
  field: ContentAuditField;
  token: string | null;
  originalValue: string;
  originalValueFingerprint: string;
  originalBulletIndex: number | null;
  actualLength: number | null;
  minLength: number | null;
  maxLength: number | null;
  reason: string;
  relatedIngredients: string | null;
  relatedIngredientsFingerprint: string | null;
};

export type ContentAuditQuickEditFocus = {
  sellerSku: string;
  asin: string;
  productType: string;
  reason: string;
  fields: ContentAuditField[];
  bulletIndices: number[];
  evidence: ContentAuditQuickEditEvidence[];
};

export type ResolvedContentAuditQuickEditFocus = {
  reason: string;
  fields: ContentAuditField[];
  bulletIndices: number[];
  relocationNote: string | null;
  reasons: Array<{
    field: ContentAuditField;
    bulletIndex: number | null;
    message: string;
  }>;
};

export type ContentAuditQuickEditAvailability =
  | {
      status: "ready";
      reason: string;
      focus: ContentAuditQuickEditFocus;
    }
  | {
      status: "unavailable";
      reason: string;
      unavailableReason: string;
    };

export type ContentAuditQuickEditResolution =
  | {
      status: "focused";
      focus: ResolvedContentAuditQuickEditFocus;
    }
  | {
      status: "stale";
      message: string;
    };

type FreshListingForQuickEdit = {
  sellerSku: string;
  asin: string | null;
  productType: string;
  content: {
    title: string;
    itemHighlight: string;
    bulletPoints: readonly string[];
    productDescription: string;
    ingredients: string;
  };
};

function problemMessage(payload: ApiProblem, fallback: string): string {
  const requestId = payload.requestId ? `（Request ID: ${payload.requestId}）` : "";
  return `${payload.message || fallback}${requestId}`;
}

export function contentAuditWorkbookDownloadUrl(
  marketplaceId: string,
  exportId: string,
  scope: "attention" | "all",
): string {
  const params = new URLSearchParams({
    marketplaceId,
    exportId,
    audit: "1",
    download: "1",
    scope,
  });
  return `/api/sp-api/listing-content/export?${params}`;
}

export function assertContentAuditWorkbookDownloadEvidence(
  response: Response,
  scope: "attention" | "all",
  expectedRowCount: number,
): void {
  if (scope !== "all") return;
  if (
    response.headers.get("x-content-audit-export-scope") !== "all" ||
    response.headers.get("x-exported-fba-sku-count") !== String(expectedRowCount)
  ) {
    throw new Error(
      "目前的 Notebook Key 尚未支援「全部商品文案」Excel；請先更新 AMZ.API App。",
    );
  }
}

function parseContentWorkbookValues(raw: unknown): ContentWorkbookValues {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Excel 預檢缺少可核對的原值或更新值。");
  }
  const value = raw as Record<string, unknown>;
  const title = value.title;
  const itemHighlight = value.itemHighlight;
  const bulletPoints = value.bulletPoints;
  const productDescription = value.productDescription;
  const ingredients = value.ingredients;
  if (
    typeof title !== "string" || title.length > 2_000 ||
    typeof itemHighlight !== "string" || itemHighlight.length > 2_000 ||
    !Array.isArray(bulletPoints) || bulletPoints.length > 5 ||
    !bulletPoints.every((bullet) =>
      typeof bullet === "string" && bullet.length <= 5_000
    ) ||
    typeof productDescription !== "string" || productDescription.length > 50_000 ||
    typeof ingredients !== "string" || ingredients.length > 20_000
  ) {
    throw new Error("Excel 預檢的原值或更新值格式無效。");
  }
  return {
    title,
    itemHighlight,
    bulletPoints: bulletPoints as string[],
    productDescription,
    ingredients,
  };
}

function sameContentWorkbookField(
  field: ContentAuditField,
  previous: ContentWorkbookValues,
  requested: ContentWorkbookValues,
): boolean {
  if (field === "bulletPoints") {
    return previous.bulletPoints.length === requested.bulletPoints.length &&
      previous.bulletPoints.every(
        (bullet, index) => bullet === requested.bulletPoints[index],
      );
  }
  return previous[field] === requested[field];
}

function parseContentWorkbookExactBulletReplacement(
  raw: unknown,
  previous: ContentWorkbookValues,
  requested: ContentWorkbookValues,
): ContentWorkbookExactBulletReplacement | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Excel 預檢缺少可核對的產品要點刪除明細。");
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "currentExactLanguageBulletPoints",
    "languageTag",
    "removedOverflowBulletPoints",
    "requestedExactLanguageBulletPoints",
  ].sort();
  const unsafeDisplayText =
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u0084\u0086-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u;
  const validBulletArray = (
    candidate: unknown,
    maximum: number,
  ): candidate is string[] =>
    Array.isArray(candidate) &&
    candidate.length <= maximum &&
    candidate.every((bullet) =>
      typeof bullet === "string" &&
      bullet.length > 0 &&
      bullet.length <= 5_000 &&
      bullet === bullet.trim() &&
      !unsafeDisplayText.test(bullet)
    );
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    typeof value.languageTag !== "string" ||
    !value.languageTag ||
    value.languageTag.length > 64 ||
    value.languageTag !== value.languageTag.trim() ||
    !validBulletArray(value.currentExactLanguageBulletPoints, 100) ||
    value.currentExactLanguageBulletPoints.length <= 5 ||
    !validBulletArray(value.requestedExactLanguageBulletPoints, 5) ||
    !validBulletArray(value.removedOverflowBulletPoints, 95)
  ) {
    throw new Error("Excel 預檢的產品要點刪除明細格式無效。");
  }
  const current = value.currentExactLanguageBulletPoints;
  const replacement = value.requestedExactLanguageBulletPoints;
  const removed = value.removedOverflowBulletPoints;
  const same = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
  if (
    !same(current.slice(0, 5), previous.bulletPoints) ||
    !same(replacement, requested.bulletPoints) ||
    !same(removed, current.slice(5))
  ) {
    throw new Error("Excel 預檢的產品要點刪除明細與前後內容不一致。");
  }
  return {
    languageTag: value.languageTag,
    currentExactLanguageBulletPoints: [...current],
    requestedExactLanguageBulletPoints: [...replacement],
    removedOverflowBulletPoints: [...removed],
  };
}

function parseContentWorkbookBatchDiff(
  raw: unknown,
  invalidStructureMessage: string,
  invalidDiffMessage: string,
  options: Readonly<{ allowExactBulletReplacement?: boolean }> = {},
): Readonly<{
  sellerSku: string;
  changedFields: ContentAuditField[];
  previous: ContentWorkbookValues;
  requested: ContentWorkbookValues;
}> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(invalidStructureMessage);
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.sellerSku !== "string" ||
    !candidate.sellerSku ||
    candidate.sellerSku.length > 100 ||
    !Array.isArray(candidate.changedFields)
  ) {
    throw new Error(invalidStructureMessage);
  }
  const changedFields = candidate.changedFields.filter(
    (field): field is ContentAuditField => CONTENT_AUDIT_FIELDS.has(field),
  );
  const previous = parseContentWorkbookValues(candidate.previous);
  const requested = parseContentWorkbookValues(candidate.requested);
  const actualChangedFields = CONTENT_WORKBOOK_FIELDS.filter(
    (field) => !sameContentWorkbookField(field, previous, requested),
  );
  const exactReplacementFields = [...actualChangedFields];
  if (
    options.allowExactBulletReplacement &&
    !exactReplacementFields.includes("bulletPoints")
  ) {
    const insertAt = exactReplacementFields.findIndex((field) =>
      field === "productDescription" || field === "ingredients"
    );
    exactReplacementFields.splice(
      insertAt < 0 ? exactReplacementFields.length : insertAt,
      0,
      "bulletPoints",
    );
  }
  const exactFieldSet = (expected: readonly ContentAuditField[]) =>
    changedFields.length === expected.length &&
    expected.every((field) => changedFields.includes(field));
  if (
    !changedFields.length ||
    !actualChangedFields.length ||
    changedFields.length !== candidate.changedFields.length ||
    new Set(changedFields).size !== changedFields.length ||
    (!exactFieldSet(actualChangedFields) &&
      !exactFieldSet(exactReplacementFields))
  ) {
    throw new Error(invalidDiffMessage);
  }
  return {
    sellerSku: candidate.sellerSku,
    changedFields,
    previous,
    requested,
  };
}

function parseContentWorkbookBlockedChanges(
  raw: unknown,
  requireRows = false,
): ContentWorkbookBlockedChange[] {
  if (
    !Array.isArray(raw) ||
    raw.length > 500 ||
    (requireRows && raw.length === 0)
  ) {
    throw new Error("Excel 預檢的略過清單格式無效。");
  }
  const blockedChanges = raw.map((rawCandidate) => {
    const diff = parseContentWorkbookBatchDiff(
      rawCandidate,
      "Excel 預檢含有無法核對的略過 SKU。",
      "Excel 預檢的略過欄位清單與前後內容不一致。",
    );
    const candidate = rawCandidate as Record<string, unknown>;
    if (
      candidate.code !== "CONTENT_READ_INCOMPLETE" ||
      typeof candidate.message !== "string" ||
      !candidate.message ||
      candidate.message.length > 2_048
    ) {
      throw new Error("Excel 預檢的略過原因無效。");
    }
    return {
      ...diff,
      code: "CONTENT_READ_INCOMPLETE" as const,
      message: candidate.message,
    };
  });
  if (
    new Set(blockedChanges.map((change) => change.sellerSku)).size !==
      blockedChanges.length
  ) {
    throw new Error("Excel 預檢含有重複的略過 SKU。");
  }
  return blockedChanges;
}

function parseContentWorkbookSkippedRows(
  raw: unknown,
  requireRows = false,
): ContentWorkbookSkippedRow[] {
  if (
    !Array.isArray(raw) ||
    raw.length > 500 ||
    (requireRows && raw.length === 0)
  ) {
    throw new Error("Excel 略過問題清單格式無效。");
  }
  const rows = raw.map((rawCandidate) => {
    if (!rawCandidate || typeof rawCandidate !== "object" ||
      Array.isArray(rawCandidate)) {
      throw new Error("Excel 略過問題清單含有無法核對的列。");
    }
    const candidate = rawCandidate as Record<string, unknown>;
    if (
      (candidate.sellerSku !== null &&
        (typeof candidate.sellerSku !== "string" ||
          !candidate.sellerSku || candidate.sellerSku.length > 100)) ||
      (candidate.sourceSheet !== null &&
        (typeof candidate.sourceSheet !== "string" ||
          !candidate.sourceSheet || candidate.sourceSheet.length > 31)) ||
      (candidate.rowNumber !== null &&
        (typeof candidate.rowNumber !== "number" ||
          !Number.isSafeInteger(candidate.rowNumber) ||
          candidate.rowNumber < 2 || candidate.rowNumber > 1_048_576)) ||
      !["WORKBOOK", "SOURCE_CHECK", "LOCAL_VALIDATION", "AMAZON_PREVIEW"]
        .includes(String(candidate.stage)) ||
      typeof candidate.code !== "string" || !candidate.code ||
      candidate.code.length > 256 ||
      !Array.isArray(candidate.fields) || !candidate.fields.length ||
      candidate.fields.length > 20 ||
      candidate.fields.some((field) =>
        typeof field !== "string" || !field || field.length > 128
      ) ||
      new Set(candidate.fields).size !== candidate.fields.length ||
      typeof candidate.message !== "string" || !candidate.message ||
      candidate.message.length > 10_000
    ) {
      throw new Error("Excel 略過問題清單含有無法核對的欄位或原因。");
    }
    return {
      sellerSku: candidate.sellerSku as string | null,
      sourceSheet: candidate.sourceSheet as string | null,
      rowNumber: candidate.rowNumber as number | null,
      stage: candidate.stage as ContentWorkbookSkippedRow["stage"],
      code: candidate.code as string,
      fields: [...candidate.fields] as string[],
      message: candidate.message as string,
    };
  });
  const keys = rows.map((row) => JSON.stringify([
    row.sellerSku,
    row.sourceSheet,
    row.rowNumber,
    row.stage,
    row.code,
  ]));
  if (new Set(keys).size !== keys.length) {
    throw new Error("Excel 略過問題清單含有重複列。");
  }
  return rows;
}

function parseContentWorkbookBatchIssue(
  raw: unknown,
  invalidMessage: string,
): ContentWorkbookBatchIssue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(invalidMessage);
  }
  const issue = raw as Record<string, unknown>;
  const parseIdentifiers = (value: unknown, optional: boolean): string[] | undefined => {
    if (value === undefined && optional) return undefined;
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some((entry) =>
        typeof entry !== "string" || !entry || entry.length > 128
      )
    ) {
      throw new Error(invalidMessage);
    }
    return [...value] as string[];
  };
  if (
    (issue.code !== null &&
      (typeof issue.code !== "string" || !issue.code || issue.code.length > 128)) ||
    typeof issue.severity !== "string" ||
    !["ERROR", "WARNING", "INFO"].includes(issue.severity) ||
    typeof issue.message !== "string" ||
    !issue.message ||
    issue.message.length > 10_000
  ) {
    throw new Error(invalidMessage);
  }
  const attributeNames = parseIdentifiers(issue.attributeNames, false) ?? [];
  const categories = parseIdentifiers(issue.categories, true);
  const marketplaceIds = parseIdentifiers(issue.marketplaceIds, true);
  return {
    code: issue.code as string | null,
    severity: issue.severity,
    message: issue.message,
    attributeNames,
    ...(categories ? { categories } : {}),
    ...(marketplaceIds ? { marketplaceIds } : {}),
  };
}

export function parseContentWorkbookBatchPreview(
  raw: unknown,
  marketplaceId: string,
): ContentWorkbookBatchPreview {
  if (!raw || typeof raw !== "object") throw new Error("Excel 預檢回應格式無效。");
  const value = raw as Partial<ContentWorkbookBatchPreview>;
  if (value.status !== "READY") {
    throw new Error("Excel 預檢狀態格式無效；INVALID SKU 必須隔離且不可強制送出。");
  }
  if (
    typeof value.previewId !== "string" ||
    !value.previewId ||
    value.previewId.length > 128 ||
    value.marketplaceId !== marketplaceId ||
    typeof value.expiresAt !== "string" ||
    !value.expiresAt ||
    value.status !== "READY" ||
    !Array.isArray(value.changes) ||
    !value.changes.length ||
    !value.validationOverride ||
    typeof value.validationOverride !== "object" ||
    typeof value.validationOverride.required !== "boolean" ||
    !Array.isArray(value.validationOverride.sellerSkus)
  ) {
    throw new Error("Excel 預檢缺少可核對的站點或變更清單。");
  }
  const changes = value.changes.map((rawCandidate) => {
    const diff = parseContentWorkbookBatchDiff(
      rawCandidate,
      "Excel 預檢含有無法核對的 SKU 變更。",
      "Excel 預檢的欄位清單與前後內容不一致。",
      { allowExactBulletReplacement: true },
    );
    const candidate = rawCandidate as Record<string, unknown>;
    if (
      !Array.isArray(candidate.issues) ||
      candidate.issues.length > 100 ||
      (candidate.validationStatus !== "VALID" &&
        candidate.validationStatus !== "SIMULATED") ||
      candidate.overrideAllowed !== false
    ) {
      throw new Error("Excel 預檢含有無法核對的 SKU 變更。");
    }
    const issues = candidate.issues.map((issue) =>
      parseContentWorkbookBatchIssue(
        issue,
        "Excel 預檢含有無法顯示的 Amazon 提醒。",
      )
    );
    if (!Object.prototype.hasOwnProperty.call(candidate, "exactBulletReplacement")) {
      throw new Error(
        "目前 Notebook Key 版本過舊，缺少產品要點刪除保護；請先更新 Mac／Windows Notebook Key，再重新預檢。",
      );
    }
    const exactBulletReplacement =
      parseContentWorkbookExactBulletReplacement(
        candidate.exactBulletReplacement,
        diff.previous,
        diff.requested,
      );
    return {
      ...diff,
      exactBulletReplacement,
      issues,
      validationStatus: candidate.validationStatus as
        ContentWorkbookBatchPreview["changes"][number]["validationStatus"],
      overrideAllowed: false as const,
    };
  });
  if (new Set(changes.map((change) => change.sellerSku)).size !== changes.length) {
    throw new Error("Excel 預檢含有重複 SKU，無法安全核對。");
  }
  const blockedChanges = parseContentWorkbookBlockedChanges(
    value.blockedChanges ?? [],
  );
  const skippedRows = parseContentWorkbookSkippedRows(
    value.skippedRows ?? [],
  );
  const validationFailures = value.validationFailures === undefined ||
      (Array.isArray(value.validationFailures) &&
        value.validationFailures.length === 0)
    ? []
    : parseContentWorkbookBatchFailure({
        code: "CONTENT_BATCH_VALIDATION_FAILED",
        message: "Amazon 預檢失敗 SKU 已隔離。",
        writeCount: 0,
        rows: value.validationFailures,
        blockedChanges: [],
        skippedRows: [],
      }).rows;
  const blockedSellerSkus = blockedChanges.map((change) => change.sellerSku);
  const skippedSellerSkus = skippedRows.flatMap((row) =>
    row.sellerSku ? [row.sellerSku] : []
  );
  if (
    new Set(blockedSellerSkus).size !== blockedSellerSkus.length ||
    blockedSellerSkus.some((sellerSku) =>
      changes.some((change) => change.sellerSku === sellerSku)
    ) ||
    skippedSellerSkus.some((sellerSku) =>
      changes.some((change) => change.sellerSku === sellerSku) ||
      blockedSellerSkus.includes(sellerSku)
    ) ||
    validationFailures.some((failure) =>
      changes.some((change) => change.sellerSku === failure.sellerSku) ||
      blockedSellerSkus.includes(failure.sellerSku) ||
      skippedSellerSkus.includes(failure.sellerSku)
    ) ||
    changes.length + blockedChanges.length + skippedRows.length +
        validationFailures.length > 500
  ) {
    throw new Error("Excel 預檢的更新與略過 SKU 清單重複或超過安全上限。");
  }
  const declaredOverrideSellerSkus = value.validationOverride.sellerSkus;
  if (
    value.validationOverride.required !== false ||
    declaredOverrideSellerSkus.length !== 0 ||
    declaredOverrideSellerSkus.some((sellerSku) =>
      typeof sellerSku !== "string" || !sellerSku || sellerSku.length > 100
    )
  ) {
    throw new Error("Excel 預檢不得提供強制送出 SKU。");
  }
  return {
    previewId: value.previewId,
    marketplaceId,
    expiresAt: value.expiresAt,
    status: value.status,
    changes,
    blockedChanges,
    skippedRows,
    validationFailures,
    validationOverride: {
      required: false,
      sellerSkus: [],
    },
    notice: typeof value.notice === "string" ? value.notice : "Excel 預檢完成，尚未寫入 Amazon。",
  };
}

export function contentWorkbookBatchCommitBody(
  preview: ContentWorkbookBatchPreview,
  marketplaceId: string,
  idempotencyKey: string,
) {
  const body = {
    marketplaceId,
    previewId: preview.previewId,
    idempotencyKey,
  };
  const exactBulletReplacementSellerSkus = preview.changes
    .filter((change) => change.exactBulletReplacement !== null)
    .map((change) => change.sellerSku);
  return {
    ...body,
    ...(exactBulletReplacementSellerSkus.length
      ? {
          exactBulletReplacement: {
            acknowledged: true as const,
            sellerSkus: exactBulletReplacementSellerSkus,
          },
        }
      : {}),
  };
}

export function parseContentWorkbookBatchFailure(
  raw: unknown,
): ContentWorkbookBatchFailure {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Excel 預檢失敗明細格式無效。");
  }
  const value = raw as Partial<ContentWorkbookBatchFailure>;
  if (
    value.code !== "CONTENT_BATCH_VALIDATION_FAILED" ||
    typeof value.message !== "string" ||
    value.message.length > 10_000 ||
    value.writeCount !== 0 ||
    !Array.isArray(value.rows) ||
    !value.rows.length ||
    value.rows.length > 500
  ) {
    throw new Error("Excel 預檢失敗回應缺少可核對的 SKU 明細。");
  }
  const rows = value.rows.map((rawCandidate) => {
    const diff = parseContentWorkbookBatchDiff(
      rawCandidate,
      "Excel 預檢失敗回應含有無法核對的 SKU 狀態。",
      "Excel 預檢失敗明細的欄位與前後內容不一致。",
      { allowExactBulletReplacement: true },
    );
    const candidate = rawCandidate as Record<string, unknown>;
    if (
      typeof candidate.code !== "string" ||
      !candidate.code ||
      candidate.code.length > 128 ||
      typeof candidate.message !== "string" ||
      !candidate.message ||
      candidate.message.length > 10_000 ||
      (candidate.requestId !== null &&
        (typeof candidate.requestId !== "string" ||
          candidate.requestId.length > 128)) ||
      !Array.isArray(candidate.issues) ||
      candidate.issues.length > 100 ||
      candidate.overrideAllowed !== false
    ) {
      throw new Error("Excel 預檢失敗回應含有無法核對的 SKU 狀態。");
    }
    const issues = candidate.issues.map((issue) =>
      parseContentWorkbookBatchIssue(
        issue,
        "Excel 預檢失敗明細含有無法顯示的 Amazon issue。",
      )
    );
    return {
      ...diff,
      code: candidate.code as string,
      message: candidate.message as string,
      requestId: candidate.requestId as string | null,
      issues,
      overrideAllowed: false as const,
    };
  });
  const blockedChanges = parseContentWorkbookBlockedChanges(
    value.blockedChanges ?? [],
  );
  const skippedRows = parseContentWorkbookSkippedRows(
    value.skippedRows ?? [],
  );
  const rowSellerSkus = rows.map((row) => row.sellerSku);
  const skippedSellerSkus = skippedRows.flatMap((row) =>
    row.sellerSku ? [row.sellerSku] : []
  );
  if (
    new Set(rowSellerSkus).size !== rowSellerSkus.length ||
    rows.length + blockedChanges.length + skippedRows.length > 500
  ) {
    throw new Error("Excel 預檢失敗回應的 SKU 清單超過安全上限或含有重複。");
  }
  if (
    blockedChanges.some((change) => rowSellerSkus.includes(change.sellerSku)) ||
    skippedSellerSkus.some((sellerSku) =>
      rowSellerSkus.includes(sellerSku) ||
      blockedChanges.some((change) => change.sellerSku === sellerSku)
    )
  ) {
    throw new Error("Excel 預檢失敗與略過 SKU 清單重複。");
  }
  return {
    code: "CONTENT_BATCH_VALIDATION_FAILED",
    message: value.message,
    writeCount: 0,
    rows,
    blockedChanges,
    skippedRows,
  };
}

export function parseContentWorkbookBatchBlockedFailure(
  raw: unknown,
): ContentWorkbookBatchBlockedFailure {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Excel 略過明細格式無效。");
  }
  const value = raw as Partial<ContentWorkbookBatchBlockedFailure>;
  if (
    value.code !== "CONTENT_READ_INCOMPLETE" ||
    typeof value.message !== "string" ||
    !value.message ||
    value.message.length > 10_000 ||
    value.writeCount !== 0
  ) {
    throw new Error("Excel 略過回應缺少可核對的 SKU 明細。");
  }
  return {
    code: "CONTENT_READ_INCOMPLETE",
    message: value.message,
    writeCount: 0,
    blockedChanges: parseContentWorkbookBlockedChanges(
      value.blockedChanges,
      true,
    ),
  };
}

export function parseContentWorkbookBatchAllSkippedFailure(
  raw: unknown,
): ContentWorkbookBatchAllSkippedFailure {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Excel 全部略過明細格式無效。");
  }
  const value = raw as Partial<ContentWorkbookBatchAllSkippedFailure>;
  if (
    value.code !== "CONTENT_BATCH_ALL_SKIPPED" ||
    typeof value.message !== "string" || !value.message ||
    value.message.length > 10_000 || value.writeCount !== 0
  ) {
    throw new Error("Excel 全部略過回應缺少可核對的 SKU 明細。");
  }
  const skippedRows = parseContentWorkbookSkippedRows(
    value.skippedRows,
    true,
  );
  const blockedChanges = parseContentWorkbookBlockedChanges(
    value.blockedChanges ?? [],
  );
  if (
    skippedRows.length + blockedChanges.length > 500 ||
    skippedRows.some((row) =>
      row.sellerSku !== null &&
      blockedChanges.some((change) => change.sellerSku === row.sellerSku)
    )
  ) {
    throw new Error("Excel 全部略過清單超過安全上限。");
  }
  return {
    code: "CONTENT_BATCH_ALL_SKIPPED",
    message: value.message,
    writeCount: 0,
    skippedRows,
    blockedChanges,
  };
}

export function parseContentWorkbookBatchResult(
  raw: unknown,
  marketplaceId: string,
): ContentWorkbookBatchResult {
  if (!raw || typeof raw !== "object") throw new Error("Excel 更新回應格式無效。");
  const value = raw as Partial<ContentWorkbookBatchResult>;
  if (
    typeof value.previewId !== "string" ||
    value.marketplaceId !== marketplaceId ||
    (value.status !== "COMPLETED" &&
      value.status !== "COMPLETED_WITH_ISSUES" &&
      value.status !== "STOPPED_REJECTED" &&
      value.status !== "STOPPED_UNKNOWN") ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("Excel 更新回應缺少可核對的逐 SKU 結果。");
  }
  const rows = value.rows.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.sellerSku !== "string" ||
      !candidate.sellerSku ||
      candidate.sellerSku.length > 100 ||
      !["verified", "simulated", "rejected", "unknown", "not-started"].includes(
        candidate.state,
      )
    ) {
      throw new Error("Excel 更新回應含有無法核對的 SKU 狀態。");
    }
    return {
      sellerSku: candidate.sellerSku,
      state: candidate.state,
      error:
        candidate.error && typeof candidate.error.message === "string"
          ? candidate.error
          : null,
    };
  });
  const blockedChanges = parseContentWorkbookBlockedChanges(
    value.blockedChanges ?? [],
  );
  const skippedRows = parseContentWorkbookSkippedRows(
    value.skippedRows ?? [],
  );
  const validationFailures = value.validationFailures === undefined ||
      (Array.isArray(value.validationFailures) &&
        value.validationFailures.length === 0)
    ? []
    : parseContentWorkbookBatchFailure({
        code: "CONTENT_BATCH_VALIDATION_FAILED",
        message: "Amazon 預檢失敗 SKU 已隔離。",
        writeCount: 0,
        rows: value.validationFailures,
        blockedChanges: [],
        skippedRows: [],
      }).rows;
  const rowSellerSkus = rows.map((row) => row.sellerSku);
  const skippedSellerSkus = skippedRows.flatMap((row) =>
    row.sellerSku ? [row.sellerSku] : []
  );
  const validationFailureSellerSkus = validationFailures.map((failure) =>
    failure.sellerSku
  );
  if (
    rows.length + blockedChanges.length + skippedRows.length +
        validationFailures.length > 500 ||
    new Set(rowSellerSkus).size !== rowSellerSkus.length ||
    blockedChanges.some((change) => rowSellerSkus.includes(change.sellerSku)) ||
    skippedSellerSkus.some((sellerSku) =>
      rowSellerSkus.includes(sellerSku) ||
      blockedChanges.some((change) => change.sellerSku === sellerSku)
    ) ||
    validationFailureSellerSkus.some((sellerSku) =>
      rowSellerSkus.includes(sellerSku) ||
      skippedSellerSkus.includes(sellerSku) ||
      blockedChanges.some((change) => change.sellerSku === sellerSku)
    )
  ) {
    throw new Error("Excel 更新回應的更新與略過 SKU 清單重複或超過安全上限。");
  }
  return {
    previewId: value.previewId,
    marketplaceId,
    status: value.status,
    rows,
    blockedChanges,
    skippedRows,
    validationFailures,
    notice: typeof value.notice === "string" ? value.notice : "批次處理完成。",
  };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function reportReply(raw: Record<string, unknown>): ReportReply {
  const reportId = raw.reportId ?? raw.report_id;
  const documentId = raw.documentId ?? raw.reportDocumentId ?? raw.document_id;
  return {
    ready: raw.ready === true,
    reportId: typeof reportId === "string" ? reportId : null,
    documentId: typeof documentId === "string" ? documentId : null,
    status: typeof raw.status === "string" ? raw.status : null,
    progress:
      typeof raw.progress === "number" && Number.isFinite(raw.progress)
        ? raw.progress
        : null,
    message: typeof raw.message === "string" ? raw.message : null,
  };
}

const CONTENT_AUDIT_ISSUE_KINDS = new Set<ContentAuditIssueKind>([
  "MISSING_BULLETS",
  "MISSING_INGREDIENTS",
  "INGREDIENTS_UNVERIFIED",
  "TITLE_BELOW_TARGET",
  "HIGHLIGHT_BELOW_TARGET",
  "BULLET_BELOW_TARGET",
  "BULLET_ABOVE_TARGET",
  "DESCRIPTION_BELOW_TARGET",
  "SINGLE_INGREDIENT_MISMATCH",
  "SUSPECTED_TYPO",
]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validLengthIssue(
  issue: Partial<ContentAuditIssue>,
  row: Pick<
    ContentAuditRow,
    "title" | "itemHighlight" | "bulletPoints" | "productDescription"
  >,
): boolean {
  if (!isNonNegativeInteger(issue.actualLength)) return false;
  if (issue.kind === "TITLE_BELOW_TARGET") {
    return issue.field === "title" &&
      issue.minLength === CONTENT_AUDIT_LENGTH_TARGETS.titleMinimum &&
      issue.maxLength === undefined &&
      issue.actualLength === trimmedUnicodeLength(row.title) &&
      issue.actualLength < issue.minLength;
  }
  if (issue.kind === "HIGHLIGHT_BELOW_TARGET") {
    return issue.field === "itemHighlight" &&
      issue.minLength === CONTENT_AUDIT_LENGTH_TARGETS.itemHighlightMinimum &&
      issue.maxLength === undefined &&
      issue.actualLength === trimmedUnicodeLength(row.itemHighlight ?? "") &&
      issue.actualLength < issue.minLength;
  }
  if (
    issue.kind === "BULLET_BELOW_TARGET" ||
    issue.kind === "BULLET_ABOVE_TARGET"
  ) {
    if (
      issue.field !== "bulletPoints" ||
      !isNonNegativeInteger(issue.bulletIndex) ||
      issue.bulletIndex >= row.bulletPoints.length ||
      issue.minLength !== CONTENT_AUDIT_LENGTH_TARGETS.bulletMinimum ||
      issue.maxLength !== CONTENT_AUDIT_LENGTH_TARGETS.bulletMaximum
    ) {
      return false;
    }
    const actualLength = trimmedUnicodeLength(
      row.bulletPoints[issue.bulletIndex] ?? "",
    );
    return issue.actualLength === actualLength &&
      (issue.kind === "BULLET_BELOW_TARGET"
        ? actualLength < issue.minLength
        : actualLength > issue.maxLength);
  }
  if (issue.kind === "DESCRIPTION_BELOW_TARGET") {
    return issue.field === "productDescription" &&
      issue.minLength ===
        CONTENT_AUDIT_LENGTH_TARGETS.productDescriptionMinimum &&
      issue.maxLength === undefined &&
      issue.actualLength === trimmedUnicodeLength(row.productDescription ?? "") &&
      issue.actualLength < issue.minLength;
  }
  return false;
}

function validContentAuditIssue(
  candidate: unknown,
  row: Pick<
    ContentAuditRow,
    | "title"
    | "itemHighlight"
    | "bulletPoints"
    | "productDescription"
    | "ingredients"
  >,
): candidate is ContentAuditIssue {
  if (!candidate || typeof candidate !== "object") return false;
  const issue = candidate as Partial<ContentAuditIssue>;
  if (
    !CONTENT_AUDIT_ISSUE_KINDS.has(issue.kind as ContentAuditIssueKind) ||
    !CONTENT_AUDIT_FIELDS.has(issue.field as ContentAuditField) ||
    typeof issue.message !== "string"
  ) {
    return false;
  }
  if (
    issue.source !== undefined &&
    issue.source !== "amazon-content" &&
    issue.source !== "pages-dictionary"
  ) {
    return false;
  }
  if (
    issue.kind === "TITLE_BELOW_TARGET" ||
    issue.kind === "HIGHLIGHT_BELOW_TARGET" ||
    issue.kind === "BULLET_BELOW_TARGET" ||
    issue.kind === "BULLET_ABOVE_TARGET" ||
    issue.kind === "DESCRIPTION_BELOW_TARGET"
  ) {
    return validLengthIssue(issue, row);
  }
  if (issue.kind === "MISSING_BULLETS") return issue.field === "bulletPoints";
  if (
    issue.kind === "MISSING_INGREDIENTS" ||
    issue.kind === "INGREDIENTS_UNVERIFIED"
  ) {
    return issue.field === "ingredients";
  }
  if (issue.kind === "SINGLE_INGREDIENT_MISMATCH") {
    if (
      !issue.token ||
      !["title", "itemHighlight", "bulletPoints"].includes(issue.field ?? "")
    ) {
      return false;
    }
    const value = issue.field === "title"
      ? row.title
      : issue.field === "itemHighlight"
        ? row.itemHighlight ?? ""
        : isNonNegativeInteger(issue.bulletIndex) &&
            issue.bulletIndex < row.bulletPoints.length
          ? row.bulletPoints[issue.bulletIndex] ?? ""
          : "";
    return contentClaimTokens(value, row.ingredients).includes(issue.token);
  }
  return issue.kind === "SUSPECTED_TYPO";
}

export function parseContentAuditSnapshot(
  raw: unknown,
  expectedMarketplaceId?: string,
): ContentAuditSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("文案健檢回應格式無效。");
  const value = raw as Partial<ContentAuditSnapshot>;
  if (
    typeof value.marketplaceId !== "string" ||
    typeof value.fetchedAt !== "string" ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("文案健檢缺少可核對的站點或商品資料。");
  }
  if (
    expectedMarketplaceId !== undefined &&
    value.marketplaceId !== expectedMarketplaceId
  ) {
    throw new Error("文案健檢回應與目前選擇的站點不一致；已停止顯示與快取。");
  }
  const rows = value.rows.map((candidate, index): ContentAuditRow => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`文案健檢第 ${index + 1} 筆商品資料格式無效；已停止顯示不完整結果。`);
    }
    const row = candidate as Partial<ContentAuditRow>;
    if (typeof row.sellerSku !== "string" || !row.sellerSku.trim()) {
      throw new Error(`文案健檢第 ${index + 1} 筆商品缺少 SKU；已停止顯示不完整結果。`);
    }
    const parsedReadErrors = Array.isArray(row.readErrors)
      ? row.readErrors.filter((error): error is ContentAuditReadError =>
          Boolean(
            error &&
            typeof error === "object" &&
            ["LISTING_QUERY_FAILED", "LISTING_CONTENT_NOT_RETURNED"].includes(
              (error as ContentAuditReadError).code,
            ) &&
            typeof (error as ContentAuditReadError).message === "string",
          ),
        )
      : [];
    const readStatus =
      row.readStatus === "complete" && parsedReadErrors.length === 0
        ? "complete"
        : "incomplete";
    const readErrors =
      readStatus === "incomplete" && parsedReadErrors.length === 0
        ? [{
            code: "LISTING_CONTENT_NOT_RETURNED" as const,
            message: "回應缺少可驗證的完整讀取狀態；本列已排除缺值、字數與拼字統計。",
          }]
        : parsedReadErrors;
    const parsedRow: Omit<ContentAuditRow, "issues"> = {
      sellerSku: row.sellerSku,
      asin: typeof row.asin === "string" ? row.asin : "",
      productType: typeof row.productType === "string" ? row.productType : "",
      title: typeof row.title === "string" ? row.title : "",
      itemHighlight:
        typeof row.itemHighlight === "string" ? row.itemHighlight : "",
      bulletPoints: Array.isArray(row.bulletPoints)
        ? row.bulletPoints.filter((item): item is string => typeof item === "string")
        : [],
      productDescription:
        typeof row.productDescription === "string" ? row.productDescription : "",
      ingredients: typeof row.ingredients === "string" ? row.ingredients : "",
      readStatus,
      readErrors,
      variationRole:
        row.variationRole === "parent" ||
        row.variationRole === "child" ||
        row.variationRole === "standalone" ||
        row.variationRole === "unknown"
          ? row.variationRole
          : "unknown",
      variationParentSku:
        typeof row.variationParentSku === "string" ? row.variationParentSku : null,
      variationFamilyKey:
        typeof row.variationFamilyKey === "string" ? row.variationFamilyKey : null,
      variationTheme:
        typeof row.variationTheme === "string" ? row.variationTheme : null,
      relationshipStatus:
        row.relationshipStatus === "complete" ? "complete" : "incomplete",
      relationshipMessage:
        typeof row.relationshipMessage === "string" ? row.relationshipMessage : null,
    };
    const returnedIssues = readStatus === "complete" && Array.isArray(row.issues)
      ? row.issues.filter((issue): issue is ContentAuditIssue =>
          validContentAuditIssue(issue, parsedRow))
      : [];
    const issues = readStatus === "complete"
      ? [
          ...returnedIssues.filter(
            (issue) => issue.kind !== "SINGLE_INGREDIENT_MISMATCH",
          ),
          ...contentClaimFindings({
            title: parsedRow.title,
            itemHighlight: parsedRow.itemHighlight ?? "",
            bulletPoints: parsedRow.bulletPoints,
            ingredients: parsedRow.ingredients,
          }).map((finding) => ({
            kind: "SINGLE_INGREDIENT_MISMATCH" as const,
            ...finding,
          })),
        ]
      : [];
    return { ...parsedRow, issues };
  });
  if (
    value.summary?.total !== undefined &&
    (
      typeof value.summary.total !== "number" ||
      !Number.isInteger(value.summary.total) ||
      value.summary.total !== rows.length
    )
  ) {
    throw new Error("文案健檢商品總數與回傳列數不一致；已停止顯示不完整結果。");
  }
  const declaredTotal = rows.length;
  return {
    marketplaceId: value.marketplaceId,
    fetchedAt: value.fetchedAt,
    exportId:
      typeof value.exportId === "string" &&
      /^[A-Za-z0-9._-]{1,200}$/u.test(value.exportId)
        ? value.exportId
        : undefined,
    rows,
    readErrors: rows.flatMap((row) =>
      row.readErrors.map((readError) => ({
        sellerSku: row.sellerSku,
        ...readError,
      })),
    ),
    summary: summarizeContentAudit(rows, declaredTotal),
  };
}

function issueLabel(kind: ContentAuditIssueKind): string {
  if (kind === "MISSING_BULLETS") return "賣點不足";
  if (kind === "MISSING_INGREDIENTS") return "缺成分";
  if (kind === "INGREDIENTS_UNVERIFIED") return "成分未驗證";
  if (kind === "TITLE_BELOW_TARGET") return "產品名稱不足";
  if (kind === "HIGHLIGHT_BELOW_TARGET") return "產品亮點不足";
  if (kind === "BULLET_BELOW_TARGET") return "產品要點過短";
  if (kind === "BULLET_ABOVE_TARGET") return "產品要點過長";
  if (kind === "DESCRIPTION_BELOW_TARGET") return "產品敘述不足";
  if (kind === "SINGLE_INGREDIENT_MISMATCH") return "成分宣稱不一致";
  return "疑似錯字";
}

function typoIssuesForField(
  row: ContentAuditRow,
  field: ContentAuditIssue["field"],
): ContentAuditIssue[] {
  return row.issues.filter(
    (issue) => issue.kind === "SUSPECTED_TYPO" && issue.field === field,
  );
}

function highlightedContent(
  value: string,
  issues: readonly ContentAuditIssue[],
) {
  return contentHighlightSegments(value, issues).map((segment, index) =>
    segment.highlighted ? (
      <mark
        key={`${segment.token ?? "typo"}-${index}`}
        className="content-audit-typo-highlight"
        title={`疑似錯字：${segment.token ?? segment.text}`}
        style={{
          color: "#b42318",
          backgroundColor: "#fee4e2",
          borderRadius: "0.22em",
          fontWeight: 700,
          padding: "0 0.08em",
        }}
      >
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  );
}

function hasHighlightedContent(
  value: string,
  issues: readonly ContentAuditIssue[],
): boolean {
  return contentHighlightSegments(value, issues).some(
    (segment) => segment.highlighted,
  );
}

function invisibleIssueIsExplained(
  row: ContentAuditRow,
  issue: ContentAuditIssue,
  locations: ReturnType<typeof locateInvisibleCharacters>,
): boolean {
  return isInvisibleCharacterIssue(issue) && locations.some(
    (location) =>
      location.sellerSku === row.sellerSku &&
      location.field === issue.field &&
      location.codePoint === issue.token?.toUpperCase(),
  );
}

function contentValueFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${value.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function quickEditEvidence(
  issue: ContentAuditIssue,
  originalValue: string,
  originalBulletIndex: number | null,
  relatedIngredients: string | null = null,
): ContentAuditQuickEditEvidence {
  return {
    issueKind: issue.kind,
    field: issue.field,
    token: issue.token ?? null,
    originalValue,
    originalValueFingerprint: contentValueFingerprint(originalValue),
    originalBulletIndex,
    actualLength: issue.actualLength ?? null,
    minLength: issue.minLength ?? null,
    maxLength: issue.maxLength ?? null,
    reason: issue.message,
    relatedIngredients,
    relatedIngredientsFingerprint: relatedIngredients === null
      ? null
      : contentValueFingerprint(relatedIngredients),
  };
}

function staleQuickEditResolution(detail: string): ContentAuditQuickEditResolution {
  return {
    status: "stale",
    message: `${detail}為避免隱藏其他仍需確認的欄位，已切換為完整編輯；尚未送出任何修改。`,
  };
}

function fieldLabel(field: ContentAuditField): string {
  if (field === "title") return "商品標題";
  if (field === "itemHighlight") return "產品亮點";
  if (field === "productDescription") return "產品敘述";
  if (field === "ingredients") return "成分";
  return "賣點";
}

function workbookFieldLabel(field: ContentAuditField): string {
  if (field === "title") return "產品名稱";
  if (field === "bulletPoints") return "產品要點";
  return fieldLabel(field);
}

function amazonAttributeLabel(attributeName: string): string {
  const normalized = attributeName.toLowerCase();
  if (normalized === "item_name" || normalized === "title") return "產品名稱";
  if (normalized.includes("bullet")) return "產品要點";
  if (normalized.includes("product_description")) return "產品敘述";
  if (normalized.includes("ingredient")) return "成分";
  if (normalized.includes("highlight") || normalized.includes("benefit")) {
    return "產品亮點";
  }
  return attributeName;
}

function issueFieldLabel(issue: ContentAuditIssue): string {
  if (issue.kind === "TITLE_BELOW_TARGET") return "產品名稱";
  if (
    (issue.kind === "BULLET_BELOW_TARGET" ||
      issue.kind === "BULLET_ABOVE_TARGET") &&
    issue.bulletIndex !== undefined
  ) {
    return `產品要點 ${issue.bulletIndex + 1}`;
  }
  return fieldLabel(issue.field);
}

function ContentWorkbookValue({
  field,
  value,
}: {
  field: ContentAuditField;
  value: string | string[];
}) {
  if (field === "bulletPoints") {
    const bullets = value as string[];
    return bullets.length ? (
      <ol>
        {bullets.map((bullet, index) => (
          <li key={`${index}-${bullet}`}>{bullet || "（空白）"}</li>
        ))}
      </ol>
    ) : <p>（空白）</p>;
  }
  return <p>{(value as string) || "（空白）"}</p>;
}

function ContentWorkbookBlockedChangeList({
  blockedChanges,
}: {
  blockedChanges: ContentWorkbookBlockedChange[];
}) {
  return (
    <div className="content-audit-batch-diffs">
      {blockedChanges.map((change) => (
        <details key={change.sellerSku}>
          <summary>
            <span>{change.sellerSku}</span>
            <small>{change.changedFields.map(workbookFieldLabel).join("、")}</small>
          </summary>
          <p>{change.message}</p>
          <div className="content-audit-batch-fields">
            {change.changedFields.map((field) => (
              <section key={field}>
                <h4>{workbookFieldLabel(field)}</h4>
                <div className="content-audit-before-after">
                  <div>
                    <strong>健檢取得的原值</strong>
                    <ContentWorkbookValue
                      field={field}
                      value={change.previous[field]}
                    />
                  </div>
                  <div>
                    <strong>Excel 更新值（本次略過）</strong>
                    <ContentWorkbookValue
                      field={field}
                      value={change.requested[field]}
                    />
                  </div>
                </div>
              </section>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function ContentWorkbookSkippedRowList({
  rows,
}: {
  rows: ContentWorkbookSkippedRow[];
}) {
  return (
    <ul className="content-audit-skipped-rows">
      {rows.map((row) => (
        <li key={JSON.stringify([
          row.sellerSku,
          row.sourceSheet,
          row.rowNumber,
          row.stage,
          row.code,
        ])}>
          <div>
            <strong>{row.sellerSku ?? "無法安全辨識 Seller SKU"}</strong>
            <span>{row.fields.join("、")}</span>
          </div>
          <small>
            {row.sourceSheet && row.rowNumber
              ? `${row.sourceSheet} · Excel 第 ${row.rowNumber} 列 · `
              : ""}
            {row.message}
          </small>
        </li>
      ))}
    </ul>
  );
}

export function ContentWorkbookBatchAllSkippedFailureCard({
  failure,
}: {
  failure: ContentWorkbookBatchAllSkippedFailure;
}) {
  return (
    <div
      className="content-audit-batch-preview content-audit-batch-failure"
      role="alert"
      aria-label="Excel 有問題 SKU 全部略過明細"
    >
      <strong>{failure.message}</strong>
      <p>以下問題已在同一次上傳全部列出；這些 SKU 沒有送到 Amazon。</p>
      <ContentWorkbookSkippedRowList rows={failure.skippedRows} />
      {failure.blockedChanges.length > 0 && (
        <ContentWorkbookBlockedChangeList
          blockedChanges={failure.blockedChanges}
        />
      )}
    </div>
  );
}

export function ContentWorkbookBatchBlockedFailureCard({
  failure,
}: {
  failure: ContentWorkbookBatchBlockedFailure;
}) {
  return (
    <div
      className="content-audit-batch-preview content-audit-batch-failure"
      role="alert"
      aria-label="Excel 原掃描未完整略過明細"
    >
      <strong>{failure.message}</strong>
      <p>
        下列 {failure.blockedChanges.length.toLocaleString()} 個 SKU 全部略過且沒有寫入 Amazon；請先用「完整編輯」確認，或重新掃描後再回傳 Excel。
      </p>
      <ContentWorkbookBlockedChangeList
        blockedChanges={failure.blockedChanges}
      />
    </div>
  );
}

export function ContentWorkbookBatchFailureCard({
  failure,
}: {
  failure: ContentWorkbookBatchFailure;
}) {
  return (
    <div
      className="content-audit-batch-preview content-audit-batch-failure"
      role="alert"
      aria-label="Excel 批次預檢失敗明細"
    >
      <strong>{failure.message}</strong>
      <p>下列 SKU 沒有寫入 Amazon。請展開核對失敗欄位、原值、更新值與原因。</p>
      <div className="content-audit-batch-diffs">
        {failure.rows.map((row) => (
          <details key={row.sellerSku} open>
            <summary>
              <span>{row.sellerSku}</span>
              <small>{row.changedFields.map(workbookFieldLabel).join("、")}</small>
            </summary>
            <div className="content-audit-batch-fields">
              <div className="content-audit-validation-issues">
                <strong>未通過原因 · {row.code}</strong>
                <p>{row.message}</p>
                {row.requestId && <small>Request ID: {row.requestId}</small>}
              </div>
              {row.changedFields.map((field) => (
                <section key={field}>
                  <h4>{workbookFieldLabel(field)}</h4>
                  <div className="content-audit-before-after">
                    <div>
                      <strong>Excel 內記錄的 Amazon 原值</strong>
                      <ContentWorkbookValue field={field} value={row.previous[field]} />
                    </div>
                    <div>
                      <strong>Excel 更新值</strong>
                      <ContentWorkbookValue field={field} value={row.requested[field]} />
                    </div>
                  </div>
                </section>
              ))}
              {row.issues.length > 0 && (
                <div className="content-audit-validation-issues">
                  <strong>Amazon Validation Preview 詳細原因</strong>
                  <ul>
                    {row.issues.map((issue, index) => (
                      <li key={`${index}-${issue.code ?? "issue"}-${issue.message}`}>
                        <strong>
                          {issue.attributeNames.length
                            ? `欄位：${issue.attributeNames.map(amazonAttributeLabel).join("、")}`
                            : `欄位：Amazon 未提供（本列變更：${row.changedFields.map(workbookFieldLabel).join("、")}）`}
                        </strong>{" "}
                        {issue.code ? `${issue.code} · ` : ""}{issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!row.overrideAllowed && (
                <small>
                  此失敗不可強制略過；請依原因修正 Excel，或重新掃描後再預檢。
                </small>
              )}
            </div>
          </details>
        ))}
      </div>
      {failure.blockedChanges.length > 0 && (
        <>
          <p>
            另有 {failure.blockedChanges.length.toLocaleString()} 個原掃描未完整的 SKU 已略過且不會寫入 Amazon。
          </p>
          <ContentWorkbookBlockedChangeList
            blockedChanges={failure.blockedChanges}
          />
        </>
      )}
      {failure.skippedRows.length > 0 && (
        <>
          <p>
            另有 {failure.skippedRows.length.toLocaleString()} 個 Excel／快照問題 SKU 已隔離且未送出。
          </p>
          <ContentWorkbookSkippedRowList rows={failure.skippedRows} />
        </>
      )}
    </div>
  );
}

export function ContentWorkbookBatchPreviewCard({
  preview,
  busy,
  acknowledged,
  onAcknowledgedChange,
  onCommit,
}: {
  preview: ContentWorkbookBatchPreview;
  busy: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onCommit: () => void;
}) {
  const blockedCount = preview.blockedChanges.length;
  const removedOverflowBulletCount = preview.changes.reduce(
    (total, change) => total +
      (change.exactBulletReplacement?.removedOverflowBulletPoints.length ?? 0),
    0,
  );
  return (
    <div
      className="content-audit-batch-preview"
      role="region"
      aria-label="Excel 批次更新逐欄預覽"
    >
      <strong>
        已通過 {preview.changes.length.toLocaleString()} 個安全 SKU 的零寫入預檢
      </strong>
      <p>{preview.notice}</p>
      {preview.skippedRows.length > 0 && (
        <div className="content-audit-validation-issues" role="alert">
          <strong>
            已隔離 {preview.skippedRows.length.toLocaleString()} 個有問題的 SKU；其餘安全 SKU 可繼續
          </strong>
          <p>下列項目沒有送到 Amazon；SKU、Excel 列、欄位與原因已一次列完。</p>
          <ContentWorkbookSkippedRowList rows={preview.skippedRows} />
        </div>
      )}
      {preview.validationFailures.length > 0 && (
        <ContentWorkbookBatchFailureCard failure={{
          code: "CONTENT_BATCH_VALIDATION_FAILED",
          message:
            `${preview.validationFailures.length.toLocaleString()} 個 Amazon 預檢失敗 SKU 已隔離；其餘安全 SKU 可繼續。`,
          writeCount: 0,
          rows: preview.validationFailures,
          blockedChanges: [],
          skippedRows: [],
        }} />
      )}
      {removedOverflowBulletCount > 0 && (
        <div className="content-audit-validation-issues" role="alert">
          <strong>
            注意：本次會刪除 Amazon 目前第 6 項後的同語系產品要點，共 {removedOverflowBulletCount.toLocaleString()} 項
          </strong>
          <p>
            Excel 只載入前 5 項；每個將刪除的原值已在對應 SKU 下方完整列出，請逐項核對。
          </p>
        </div>
      )}
      {blockedCount > 0 && (
        <div className="content-audit-validation-issues" role="alert">
          <strong>
            已略過 {blockedCount.toLocaleString()} 個原掃描未完整的 SKU；它們不會寫入 Amazon
          </strong>
          <p>
            其餘已納入預檢的 SKU 可依上方結果繼續核對。請先用「完整編輯」確認略過列，或重新掃描後再回傳 Excel。
          </p>
          <ContentWorkbookBlockedChangeList
            blockedChanges={preview.blockedChanges}
          />
        </div>
      )}
      <p>
        請展開每個 SKU，逐欄核對完整「Amazon 原值」與「Excel 更新值」後再確認。
      </p>
      <div className="content-audit-batch-diffs">
        {preview.changes.map((change) => (
          <details
            key={change.sellerSku}
            open={change.exactBulletReplacement !== null}
          >
            <summary>
              <span>{change.sellerSku}</span>
              <small>{change.changedFields.map(workbookFieldLabel).join("、")}</small>
            </summary>
            <div className="content-audit-batch-fields">
              {change.exactBulletReplacement && (
                <div className="content-audit-validation-issues" role="alert">
                  <strong>
                    將刪除 Amazon 目前第 6–{change.exactBulletReplacement.currentExactLanguageBulletPoints.length} 項 {change.exactBulletReplacement.languageTag} 產品要點
                  </strong>
                  <p>
                    這次會以 Excel 的前 {change.exactBulletReplacement.requestedExactLanguageBulletPoints.length} 項完整取代 Amazon 的同語系產品要點；下列原值會被刪除：
                  </p>
                  <ol
                    className="content-audit-exact-bullet-removals"
                    start={6}
                  >
                    {change.exactBulletReplacement.removedOverflowBulletPoints
                      .map((bullet, index) => (
                        <li key={`${index + 6}-${bullet}`}>{bullet}</li>
                      ))}
                  </ol>
                </div>
              )}
              {change.changedFields.map((field) => (
                <section key={field}>
                  <h4>{workbookFieldLabel(field)}</h4>
                  <div className="content-audit-before-after">
                    <div>
                      <strong>
                        {field === "bulletPoints" &&
                            change.exactBulletReplacement
                          ? "Amazon 原值（第 1–5 項）"
                          : "Amazon 原值"}
                      </strong>
                      <ContentWorkbookValue
                        field={field}
                        value={change.previous[field]}
                      />
                    </div>
                    <div>
                      <strong>Excel 更新值</strong>
                      <ContentWorkbookValue
                        field={field}
                        value={change.requested[field]}
                      />
                    </div>
                  </div>
                </section>
              ))}
              {change.issues.length > 0 && (
                <div className="content-audit-validation-issues">
                  <strong>Amazon Validation Preview 提醒</strong>
                  <ul>
                    {change.issues.map((issue, index) => (
                      <li key={`${index}-${issue.code ?? "issue"}-${issue.message}`}>
                        <strong>
                          {issue.attributeNames.length > 0
                            ? `欄位：${issue.attributeNames.map(amazonAttributeLabel).join("、")}`
                            : `欄位：Amazon 未提供（本列變更：${change.changedFields.map(workbookFieldLabel).join("、")}）`}
                        </strong>{" "}
                        {issue.severity}{issue.code ? ` · ${issue.code}` : ""} · {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
      <label className="content-audit-batch-acknowledgement">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={busy}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
        />
        <span>
          我已核對上述每個將寫入 SKU 的完整原值、更新值、Amazon 提醒與會被刪除的第 6 項後產品要點；略過列不會寫入。
        </span>
      </label>
      <button
        type="button"
        className="price-primary-button"
        disabled={busy || !acknowledged}
        onClick={onCommit}
      >
        {busy
          ? "等待 Touch ID／Windows Hello 並逐筆核對…"
          : `一次確認並更新 ${preview.changes.length.toLocaleString()} 個 SKU`}
      </button>
      <small>
        會先重新預檢整批，再要求一次本機生物辨識；單一 SKU 若遭拒或結果不明，會個別隔離並繼續後續安全 SKU，且結果不明絕不自動重送。只有帳號、站點或安全綁定失效才會停止整批。
      </small>
      <small>
        大量批次時，Touch ID／Windows Hello 只顯示實際要寫入的 SKU 數、高風險數、刪除總數與驗證碼；完整 SKU、原值與更新值以本畫面上方逐項核對清單為準。
      </small>
    </div>
  );
}

export function ContentWorkbookBatchResultCard({
  result,
}: {
  result: ContentWorkbookBatchResult;
}) {
  return (
    <div
      className={`content-audit-batch-result ${result.status.toLocaleLowerCase()}`}
      role="status"
    >
      <strong>
        {result.status === "COMPLETED"
          ? "批次處理完成"
          : result.status === "COMPLETED_WITH_ISSUES"
            ? "批次已完成；有問題 SKU 已個別隔離"
          : result.status === "STOPPED_UNKNOWN"
            ? "遇到結果不明，已停止後續 SKU"
            : "遇到拒絕，已停止後續 SKU"}
      </strong>
      <p>{result.notice}</p>
      <ul>
        {result.rows.map((row) => (
          <li key={row.sellerSku}>
            <span>{row.sellerSku}</span>
            <small>
              {row.state === "verified"
                ? "已由 Amazon 回讀驗證"
                : row.state === "simulated"
                  ? "展示模式已模擬"
                  : row.state === "rejected"
                    ? `未送出／遭拒：${row.error?.message ?? "請重新預檢"}`
                    : row.state === "unknown"
                      ? `結果不明：${row.error?.message ?? "請先回查 Amazon"}`
                      : "尚未開始，沒有送出"}
            </small>
          </li>
        ))}
      </ul>
      {result.skippedRows.length > 0 && (
        <div className="content-audit-validation-issues" role="alert">
          <strong>
            預檢時另有 {result.skippedRows.length.toLocaleString()} 個 SKU 已隔離且未送出
          </strong>
          <ContentWorkbookSkippedRowList rows={result.skippedRows} />
        </div>
      )}
      {result.validationFailures.length > 0 && (
        <ContentWorkbookBatchFailureCard failure={{
          code: "CONTENT_BATCH_VALIDATION_FAILED",
          message:
            `預檢時已有 ${result.validationFailures.length.toLocaleString()} 個 SKU 被隔離且未送出。`,
          writeCount: 0,
          rows: result.validationFailures,
          blockedChanges: [],
          skippedRows: [],
        }} />
      )}
      {result.blockedChanges.length > 0 && (
        <div className="content-audit-validation-issues" role="alert">
          <strong>
            本次另有 {result.blockedChanges.length.toLocaleString()} 個原掃描未完整的 SKU 已略過且未寫入
          </strong>
          <ContentWorkbookBlockedChangeList
            blockedChanges={result.blockedChanges}
          />
        </div>
      )}
      <small>
        結果不明的 SKU 不會自動重送；請先到 Amazon 回查。需要下一批時再重新掃描取得最新快照。
      </small>
    </div>
  );
}

export function ContentAuditWorkbookFilePicker({
  fileName,
  disabled,
  onSelect,
}: {
  fileName: string | null;
  disabled: boolean;
  onSelect: (file: File | null) => void;
}) {
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const acceptFiles = (files: ArrayLike<File>) => {
    const selection = contentAuditWorkbookSelection(files);
    if (selection.status === "selected") {
      setSelectionError(null);
      onSelect(selection.file);
      return;
    }
    if (selection.status === "empty") {
      setSelectionError(null);
      onSelect(null);
      return;
    }
    setSelectionError(selection.message);
    onSelect(null);
  };
  return (
    <label
      className={`content-audit-file-picker${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) acceptFiles(event.dataTransfer.files);
      }}
    >
      <span aria-live="polite">
        {fileName || "選擇完整或部分工作表 .xlsx"}
      </span>
      <small>拖放單一 .xlsx 到這裡，或點選檔案</small>
      {selectionError && <small className="content-audit-file-error" role="alert">{selectionError}</small>}
      <input
        className="content-audit-file-input"
        type="file"
        aria-label="選擇要回傳的 Excel 檔案"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={disabled}
        onChange={(event) =>
          acceptFiles(consumeContentAuditWorkbookInput(event.currentTarget))}
      />
    </label>
  );
}

export function consumeContentAuditWorkbookInput(input: {
  files: ArrayLike<File> | null;
  value: string;
}): File[] {
  const files = Array.from(input.files ?? []);
  input.value = "";
  return files;
}

export type ContentAuditWorkbookSelection =
  | { status: "selected"; file: File }
  | { status: "empty" }
  | { status: "rejected"; message: string };

export function contentAuditWorkbookSelection(
  input: ArrayLike<File>,
): ContentAuditWorkbookSelection {
  const files = Array.from({ length: input.length }, (_value, index) => input[index])
    .filter((file): file is File => Boolean(file));
  if (files.length === 0) return { status: "empty" };
  if (files.length !== 1) {
    return {
      status: "rejected",
      message: "一次只能選擇一份 AMZ.API 文案健檢 .xlsx 檔案。",
    };
  }
  const [file] = files;
  if (!file || !/\.xlsx$/iu.test(file.name)) {
    return {
      status: "rejected",
      message: "只接受由 AMZ.API 匯出的 .xlsx 文案健檢檔。",
    };
  }
  return { status: "selected", file };
}

function quickEditReasonForRow(row: ContentAuditRow): string {
  if (row.readStatus !== "complete") {
    const details = row.readErrors.map((error) => error.message).filter(Boolean);
    return `讀取未完成${details.length ? `：${details.join("；")}` : ""}`;
  }
  const reasons = row.issues.map((issue) => {
    const token = issue.kind === "SUSPECTED_TYPO" && issue.token
      ? `「${issue.token}」`
      : "";
    if (isInvisibleCharacterIssue(issue)) {
      return `不可見字元（${issueFieldLabel(issue)}${token}）：已定位到需手動移除的不可見字元。`;
    }
    return `${issueLabel(issue.kind)}（${issueFieldLabel(issue)}${token}）：${issue.message}`;
  });
  return reasons.length ? reasons.join("；") : "這筆健檢目前沒有可修改的問題。";
}

export function quickEditFocusForRow(
  row: ContentAuditRow,
): ContentAuditQuickEditFocus | null {
  if (row.readStatus !== "complete" || row.issues.length === 0) return null;
  const evidence: ContentAuditQuickEditEvidence[] = [];
  const bulletIndices = new Set<number>();

  for (const issue of row.issues) {
    if (issue.kind === "TITLE_BELOW_TARGET") {
      if (!validLengthIssue(issue, row)) return null;
      evidence.push(quickEditEvidence(issue, row.title, null));
      continue;
    }

    if (issue.kind === "HIGHLIGHT_BELOW_TARGET") {
      if (!validLengthIssue(issue, row)) return null;
      evidence.push(quickEditEvidence(issue, row.itemHighlight ?? "", null));
      continue;
    }

    if (
      issue.kind === "BULLET_BELOW_TARGET" ||
      issue.kind === "BULLET_ABOVE_TARGET"
    ) {
      if (!validLengthIssue(issue, row) || issue.bulletIndex === undefined) {
        return null;
      }
      evidence.push(
        quickEditEvidence(
          issue,
          row.bulletPoints[issue.bulletIndex] ?? "",
          issue.bulletIndex,
        ),
      );
      bulletIndices.add(issue.bulletIndex);
      continue;
    }

    if (issue.kind === "DESCRIPTION_BELOW_TARGET") {
      if (!validLengthIssue(issue, row)) return null;
      evidence.push(quickEditEvidence(issue, row.productDescription ?? "", null));
      continue;
    }

    if (issue.kind === "SINGLE_INGREDIENT_MISMATCH") {
      if (!issue.token || !row.ingredients.trim()) {
        return null;
      }
      if (issue.field === "bulletPoints") {
        if (
          !isNonNegativeInteger(issue.bulletIndex) ||
          !contentClaimTokens(
            row.bulletPoints[issue.bulletIndex] ?? "",
            row.ingredients,
          ).includes(issue.token)
        ) {
          return null;
        }
        evidence.push(quickEditEvidence(
          issue,
          row.bulletPoints[issue.bulletIndex] ?? "",
          issue.bulletIndex,
          row.ingredients,
        ));
        bulletIndices.add(issue.bulletIndex);
        continue;
      }
      if (issue.field !== "title" && issue.field !== "itemHighlight") return null;
      const value = issue.field === "title" ? row.title : row.itemHighlight ?? "";
      if (!contentClaimTokens(value, row.ingredients).includes(issue.token)) return null;
      evidence.push(quickEditEvidence(issue, value, null, row.ingredients));
      continue;
    }

    if (issue.kind === "SUSPECTED_TYPO") {
      if (!issue.token) return null;
      if (issue.field === "bulletPoints") {
        const matches = row.bulletPoints
          .map((value, index) => ({ value, index }))
          .filter(({ value }) => hasHighlightedContent(value, [issue]));
        if (matches.length === 0) return null;
        for (const match of matches) {
          evidence.push(quickEditEvidence(issue, match.value, match.index));
          bulletIndices.add(match.index);
        }
        continue;
      }
      if (
        issue.field !== "title" &&
        issue.field !== "itemHighlight" &&
        issue.field !== "productDescription" &&
        issue.field !== "ingredients"
      ) return null;
      const value = issue.field === "title"
        ? row.title
        : issue.field === "itemHighlight"
          ? row.itemHighlight ?? ""
          : issue.field === "productDescription"
            ? row.productDescription ?? ""
            : row.ingredients;
      if (!hasHighlightedContent(value, [issue])) return null;
      evidence.push(quickEditEvidence(issue, value, null));
      continue;
    }

    if (issue.kind === "MISSING_BULLETS") {
      if (issue.field !== "bulletPoints") return null;
      const originalValue = JSON.stringify(row.bulletPoints);
      evidence.push(quickEditEvidence(issue, originalValue, null));
      for (let index = 0; index < 5; index += 1) {
        if (!row.bulletPoints[index]?.trim()) bulletIndices.add(index);
      }
      if (bulletIndices.size === 0) return null;
      continue;
    }

    if (
      issue.kind === "MISSING_INGREDIENTS" ||
      issue.kind === "INGREDIENTS_UNVERIFIED"
    ) {
      if (issue.field !== "ingredients") return null;
      if (issue.kind === "MISSING_INGREDIENTS" && row.ingredients.trim()) return null;
      evidence.push(quickEditEvidence(issue, row.ingredients, null));
      continue;
    }

    return null;
  }

  if (evidence.length === 0) return null;
  const fields = [...new Set(evidence.map((item) => item.field))];
  return {
    sellerSku: row.sellerSku,
    asin: row.asin,
    productType: row.productType,
    reason: quickEditReasonForRow(row),
    fields,
    bulletIndices: [...bulletIndices].sort((left, right) => left - right),
    evidence,
  };
}

export function quickEditAvailabilityForRow(
  row: ContentAuditRow,
): ContentAuditQuickEditAvailability {
  const reason = quickEditReasonForRow(row);
  const focus = quickEditFocusForRow(row);
  if (focus) return { status: "ready", reason, focus };
  return {
    status: "unavailable",
    reason,
    unavailableReason: row.readStatus !== "complete"
      ? "Amazon 原文尚未完整讀取，無法建立安全定位證據。"
      : "健檢時的原文、字詞或欄位證據不足，無法安全定位待修內容。",
  };
}

export function resolveContentAuditQuickEditFocus(
  focus: ContentAuditQuickEditFocus,
  listing: FreshListingForQuickEdit,
): ContentAuditQuickEditResolution {
  if (focus.sellerSku !== listing.sellerSku) {
    return staleQuickEditResolution(
      "Amazon 回傳的 Seller SKU 與健檢項目不一致。",
    );
  }
  if (focus.asin && focus.asin !== listing.asin) {
    return staleQuickEditResolution(
      "這個 Seller SKU 對應的 ASIN 已和健檢時不同。",
    );
  }
  if (
    focus.productType &&
    listing.productType &&
    listing.productType !== "—" &&
    focus.productType !== listing.productType
  ) {
    return staleQuickEditResolution("這個商品的 Product Type 已和健檢時不同。");
  }
  if (!Array.isArray(focus.evidence) || focus.evidence.length === 0) {
    return staleQuickEditResolution("這筆健檢結果沒有足夠的原文定位證據。");
  }

  const declaredFields = new Set(focus.fields);
  const evidenceFields = new Set(focus.evidence.map((item) => item.field));
  if (
    declaredFields.size !== evidenceFields.size ||
    [...declaredFields].some((field) => !evidenceFields.has(field))
  ) {
    return staleQuickEditResolution("這筆健檢結果的欄位定位證據不完整。");
  }

  const fields = new Set<ContentAuditField>();
  const bulletIndices = new Set<number>();
  const relocations = new Set<string>();
  const reasons: ResolvedContentAuditQuickEditFocus["reasons"] = [];
  const addReason = (
    evidence: ContentAuditQuickEditEvidence,
    field: ContentAuditField,
    bulletIndex: number | null = null,
  ) => {
    if (!evidence.reason) return;
    if (reasons.some((reason) =>
      reason.field === field &&
      reason.bulletIndex === bulletIndex &&
      reason.message === evidence.reason)) return;
    reasons.push({ field, bulletIndex, message: evidence.reason });
  };

  for (const evidence of focus.evidence) {
    if (
      contentValueFingerprint(evidence.originalValue) !==
      evidence.originalValueFingerprint
    ) {
      return staleQuickEditResolution("這筆健檢結果的原文指紋已失效。");
    }

    if (evidence.issueKind === "TITLE_BELOW_TARGET") {
      if (
        evidence.field !== "title" ||
        evidence.token !== null ||
        evidence.originalBulletIndex !== null ||
        evidence.minLength !== CONTENT_AUDIT_LENGTH_TARGETS.titleMinimum ||
        evidence.maxLength !== null ||
        !isNonNegativeInteger(evidence.actualLength) ||
        trimmedUnicodeLength(evidence.originalValue) !== evidence.actualLength ||
        evidence.actualLength >= evidence.minLength
      ) {
        return staleQuickEditResolution("產品名稱長度的健檢證據格式無效。");
      }
      if (
        listing.content.title !== evidence.originalValue ||
        contentValueFingerprint(listing.content.title) !==
          evidence.originalValueFingerprint ||
        trimmedUnicodeLength(listing.content.title) >= evidence.minLength
      ) {
        return staleQuickEditResolution(
          "產品名稱已變動，原本的字數不足可能已被修正或改寫。",
        );
      }
      fields.add("title");
      addReason(evidence, "title");
      continue;
    }

    if (evidence.issueKind === "HIGHLIGHT_BELOW_TARGET") {
      if (
        evidence.field !== "itemHighlight" ||
        evidence.token !== null ||
        evidence.originalBulletIndex !== null ||
        evidence.minLength !== CONTENT_AUDIT_LENGTH_TARGETS.itemHighlightMinimum ||
        evidence.maxLength !== null ||
        !isNonNegativeInteger(evidence.actualLength) ||
        trimmedUnicodeLength(evidence.originalValue) !== evidence.actualLength ||
        evidence.actualLength >= evidence.minLength
      ) {
        return staleQuickEditResolution("產品亮點長度的健檢證據格式無效。");
      }
      if (
        listing.content.itemHighlight !== evidence.originalValue ||
        contentValueFingerprint(listing.content.itemHighlight) !==
          evidence.originalValueFingerprint ||
        trimmedUnicodeLength(listing.content.itemHighlight) >= evidence.minLength
      ) {
        return staleQuickEditResolution(
          "產品亮點已變動，原本的字數不足可能已被修正或改寫。",
        );
      }
      fields.add("itemHighlight");
      addReason(evidence, "itemHighlight");
      continue;
    }

    if (
      evidence.issueKind === "BULLET_BELOW_TARGET" ||
      evidence.issueKind === "BULLET_ABOVE_TARGET"
    ) {
      if (
        evidence.field !== "bulletPoints" ||
        evidence.token !== null ||
        evidence.originalBulletIndex === null ||
        !isNonNegativeInteger(evidence.originalBulletIndex) ||
        evidence.minLength !== CONTENT_AUDIT_LENGTH_TARGETS.bulletMinimum ||
        evidence.maxLength !== CONTENT_AUDIT_LENGTH_TARGETS.bulletMaximum ||
        !isNonNegativeInteger(evidence.actualLength) ||
        trimmedUnicodeLength(evidence.originalValue) !== evidence.actualLength ||
        (evidence.issueKind === "BULLET_BELOW_TARGET"
          ? evidence.actualLength >= evidence.minLength
          : evidence.actualLength <= evidence.maxLength)
      ) {
        return staleQuickEditResolution("產品要點長度的健檢證據格式無效。");
      }
      const candidates = listing.content.bulletPoints.flatMap((value, index) => {
        const currentLength = trimmedUnicodeLength(value);
        const stillApplies = evidence.issueKind === "BULLET_BELOW_TARGET"
          ? currentLength < evidence.minLength!
          : currentLength > evidence.maxLength!;
        return value === evidence.originalValue &&
            contentValueFingerprint(value) === evidence.originalValueFingerprint &&
            stillApplies
          ? [index]
          : [];
      });
      if (candidates.length === 0) {
        return staleQuickEditResolution(
          "健檢標示的產品要點原文已不存在，字數問題可能已被修正或改寫。",
        );
      }
      if (candidates.length !== 1) {
        return staleQuickEditResolution(
          "健檢標示的產品要點目前有多個相同候選，無法唯一定位。",
        );
      }
      const [candidate] = candidates;
      bulletIndices.add(candidate);
      fields.add("bulletPoints");
      addReason(evidence, "bulletPoints", candidate);
      if (candidate !== evidence.originalBulletIndex) {
        relocations.add(`${evidence.originalBulletIndex}:${candidate}`);
      }
      continue;
    }

    if (evidence.issueKind === "DESCRIPTION_BELOW_TARGET") {
      if (
        evidence.field !== "productDescription" ||
        evidence.token !== null ||
        evidence.originalBulletIndex !== null ||
        evidence.minLength !==
          CONTENT_AUDIT_LENGTH_TARGETS.productDescriptionMinimum ||
        evidence.maxLength !== null ||
        !isNonNegativeInteger(evidence.actualLength) ||
        trimmedUnicodeLength(evidence.originalValue) !== evidence.actualLength ||
        evidence.actualLength >= evidence.minLength
      ) {
        return staleQuickEditResolution("產品敘述長度的健檢證據格式無效。");
      }
      if (
        listing.content.productDescription !== evidence.originalValue ||
        contentValueFingerprint(listing.content.productDescription) !==
          evidence.originalValueFingerprint ||
        trimmedUnicodeLength(listing.content.productDescription) >= evidence.minLength
      ) {
        return staleQuickEditResolution(
          "產品敘述已變動，原本的字數不足可能已被修正或改寫。",
        );
      }
      fields.add("productDescription");
      addReason(evidence, "productDescription");
      continue;
    }

    if (evidence.issueKind === "SINGLE_INGREDIENT_MISMATCH") {
      if (
        !evidence.token ||
        evidence.relatedIngredients === null ||
        evidence.relatedIngredientsFingerprint === null ||
        contentValueFingerprint(evidence.relatedIngredients) !==
          evidence.relatedIngredientsFingerprint ||
        listing.content.ingredients !== evidence.relatedIngredients ||
        contentValueFingerprint(listing.content.ingredients) !==
          evidence.relatedIngredientsFingerprint ||
        !listing.content.ingredients.trim()
      ) {
        return staleQuickEditResolution(
          "Amazon ingredients 已和健檢時不同，無法沿用成分宣稱的比對證據。",
        );
      }
      if (evidence.field === "bulletPoints") {
        if (!isNonNegativeInteger(evidence.originalBulletIndex)) {
          return staleQuickEditResolution("成分宣稱缺少原始產品要點位置。");
        }
        const candidates = listing.content.bulletPoints.flatMap((value, index) =>
          value === evidence.originalValue &&
          contentValueFingerprint(value) === evidence.originalValueFingerprint &&
          contentClaimTokens(value, listing.content.ingredients).includes(
            evidence.token!,
          )
            ? [index]
            : [],
        );
        if (candidates.length !== 1) {
          return staleQuickEditResolution(
            candidates.length === 0
              ? "健檢標示的成分宣稱原文已不存在。"
              : "健檢標示的成分宣稱目前有多個相同產品要點，無法唯一定位。",
          );
        }
        const [candidate] = candidates;
        fields.add("bulletPoints");
        bulletIndices.add(candidate);
        addReason(evidence, "bulletPoints", candidate);
        if (candidate !== evidence.originalBulletIndex) {
          relocations.add(`${evidence.originalBulletIndex}:${candidate}`);
        }
        continue;
      }
      if (evidence.field !== "title" && evidence.field !== "itemHighlight") {
        return staleQuickEditResolution("成分宣稱的欄位證據格式無效。");
      }
      const currentValue = evidence.field === "title"
        ? listing.content.title
        : listing.content.itemHighlight;
      if (
        currentValue !== evidence.originalValue ||
        contentValueFingerprint(currentValue) !== evidence.originalValueFingerprint ||
        !contentClaimTokens(currentValue, listing.content.ingredients).includes(
          evidence.token,
        )
      ) {
        return staleQuickEditResolution(
          `${fieldLabel(evidence.field)}的成分宣稱已變動或不存在。`,
        );
      }
      fields.add(evidence.field);
      addReason(evidence, evidence.field);
      continue;
    }

    if (evidence.issueKind === "SUSPECTED_TYPO") {
      if (!evidence.token) {
        return staleQuickEditResolution("這筆疑似錯字沒有可核對的字詞證據。");
      }
      const issue: ContentAuditIssue = {
        kind: "SUSPECTED_TYPO",
        field: evidence.field,
        token: evidence.token,
        message: "",
      };
      if (!hasHighlightedContent(evidence.originalValue, [issue])) {
        return staleQuickEditResolution("這筆疑似錯字的原文與字詞證據不一致。");
      }

      if (evidence.field === "bulletPoints") {
        if (
          evidence.originalBulletIndex === null ||
          !Number.isInteger(evidence.originalBulletIndex) ||
          evidence.originalBulletIndex < 0
        ) {
          return staleQuickEditResolution("這筆賣點錯字缺少原始位置證據。");
        }
        const candidates = listing.content.bulletPoints.flatMap((value, index) =>
          value === evidence.originalValue &&
          contentValueFingerprint(value) === evidence.originalValueFingerprint &&
          hasHighlightedContent(value, [issue])
            ? [index]
            : [],
        );
        if (candidates.length === 0) {
          return staleQuickEditResolution(
            "健檢標示的賣點原文已不存在，可能已被修正或改寫。",
          );
        }
        if (candidates.length !== 1) {
          return staleQuickEditResolution(
            "健檢標示的賣點目前有多個相同候選，無法唯一定位。",
          );
        }
        const [candidate] = candidates;
        bulletIndices.add(candidate);
        fields.add("bulletPoints");
        addReason(evidence, "bulletPoints", candidate);
        if (candidate !== evidence.originalBulletIndex) {
          relocations.add(`${evidence.originalBulletIndex}:${candidate}`);
        }
        continue;
      }

      if (
        evidence.originalBulletIndex !== null ||
        (
          evidence.field !== "title" &&
          evidence.field !== "itemHighlight" &&
          evidence.field !== "productDescription" &&
          evidence.field !== "ingredients"
        )
      ) {
        return staleQuickEditResolution("這筆錯字對應的欄位無法安全定位。");
      }
      const currentValue = evidence.field === "title"
        ? listing.content.title
        : evidence.field === "itemHighlight"
          ? listing.content.itemHighlight
          : evidence.field === "productDescription"
            ? listing.content.productDescription
            : listing.content.ingredients;
      if (
        currentValue !== evidence.originalValue ||
        contentValueFingerprint(currentValue) !== evidence.originalValueFingerprint ||
        !hasHighlightedContent(currentValue, [issue])
      ) {
        return staleQuickEditResolution(
          `健檢標示的${fieldLabel(evidence.field)}已變動，原問題可能已被修正或改寫。`,
        );
      }
      fields.add(evidence.field);
      addReason(evidence, evidence.field);
      continue;
    }

    if (evidence.issueKind === "MISSING_BULLETS") {
      if (evidence.field !== "bulletPoints" || evidence.token !== null) {
        return staleQuickEditResolution("缺少賣點的健檢證據格式無效。");
      }
      const missingIndices = Array.from({ length: 5 }, (_value, index) => index)
        .filter((index) => !listing.content.bulletPoints[index]?.trim());
      if (missingIndices.length === 0) {
        return staleQuickEditResolution(
          "Amazon 目前已有五個賣點，原本的賣點不足已變動或解決。",
        );
      }
      missingIndices.forEach((index) => bulletIndices.add(index));
      missingIndices.forEach((index) => addReason(evidence, "bulletPoints", index));
      fields.add("bulletPoints");
      continue;
    }

    if (evidence.issueKind === "MISSING_INGREDIENTS") {
      if (evidence.field !== "ingredients" || listing.content.ingredients.trim()) {
        return staleQuickEditResolution(
          "Amazon 目前已有成分內容，原本的缺成分問題已變動或解決。",
        );
      }
      fields.add("ingredients");
      addReason(evidence, "ingredients");
      continue;
    }

    if (evidence.issueKind === "INGREDIENTS_UNVERIFIED") {
      if (
        evidence.field !== "ingredients" ||
        listing.content.ingredients !== evidence.originalValue ||
        contentValueFingerprint(listing.content.ingredients) !==
          evidence.originalValueFingerprint
      ) {
        return staleQuickEditResolution(
          "成分內容已和健檢時不同，無法沿用原本的未驗證定位。",
        );
      }
      fields.add("ingredients");
      addReason(evidence, "ingredients");
      continue;
    }

    return staleQuickEditResolution("這筆健檢問題類型無法安全處理。");
  }

  if (fields.size === 0) {
    return staleQuickEditResolution("重新讀取 Amazon 後已沒有可唯一定位的待修欄位。");
  }
  if (fields.has("bulletPoints") && bulletIndices.size === 0) {
    return staleQuickEditResolution("重新讀取 Amazon 後無法唯一定位待修賣點。");
  }

  const relocatedTargets = [...relocations]
    .map((value) => Number(value.split(":")[1]) + 1)
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right);
  return {
    status: "focused",
    focus: {
      reason: focus.reason,
      fields: [...fields],
      bulletIndices: [...bulletIndices].sort((left, right) => left - right),
      relocationNote: relocatedTargets.length
        ? `Amazon 賣點順序已變動；系統依健檢時的完整原文，重新定位到賣點 ${[
            ...new Set(relocatedTargets),
          ].join("、")}。`
        : null,
      reasons,
    },
  };
}

function scanStatusText(state: AuditState, reply: ReportReply | null): string {
  if (state === "starting") return "正在請 Amazon 建立全站 FBA 商品報表…";
  if (state === "polling") return reply?.message || "Amazon 正在整理商品清單…";
  if (state === "scanning") return "正在逐一讀取 FBA 文案並套用共用英文辭典…";
  return "";
}

export default function ContentAuditPanel({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  onOpenSku,
  cachedResult = null,
  onCachedResultChange,
  initialJob = null,
  onJobChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  onOpenSku: (
    sellerSku: string,
    quickEditFocus?: ContentAuditQuickEditFocus,
  ) => void;
  cachedResult?: ContentAuditCache | null;
  onCachedResultChange?: (cache: ContentAuditCache) => void;
  initialJob?: StandaloneAuditJob | null;
  onJobChange?: (job: StandaloneAuditJob) => void;
}) {
  const matchingInitialJob = initialJob?.kind === "content" &&
      initialJob.marketplaceId === marketplaceId &&
      initialJob.mode === mode
    ? initialJob
    : null;
  const candidateInitialCache = cachedResult?.snapshot.marketplaceId === marketplaceId
    ? cachedResult
    : null;
  const initialCache = candidateInitialCache && standaloneAuditSnapshotMatchesJob(
    candidateInitialCache.snapshot,
    matchingInitialJob,
  ) ? candidateInitialCache : null;
  const initialJobError = matchingInitialJob?.ready &&
      matchingInitialJob.status !== "completed"
    ? matchingInitialJob.error.message
    : null;
  const [state, setState] = useState<AuditState>(initialCache ? "done" : "idle");
  const [reply, setReply] = useState<ReportReply | null>(null);
  const [job, setJob] = useState<StandaloneAuditJob | null>(
    matchingInitialJob,
  );
  const [snapshot, setSnapshot] = useState<ContentAuditSnapshot | null>(
    initialCache?.snapshot ?? null,
  );
  const [filter, setFilter] = useState<AuditFilter>(initialCache?.filter ?? "all");
  const [query, setQuery] = useState(initialCache?.query ?? "");
  const [error, setError] = useState<string | null>(initialJobError);
  const [exporting, setExporting] =
    useState<"attention" | "all" | null>(null);
  const [spellcheckNote, setSpellcheckNote] = useState<string | null>(
    initialCache?.spellcheckNote ?? null,
  );
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [batchPreview, setBatchPreview] =
    useState<ContentWorkbookBatchPreview | null>(null);
  const [batchFailure, setBatchFailure] =
    useState<ContentWorkbookBatchFailure | null>(null);
  const [batchBlockedFailure, setBatchBlockedFailure] =
    useState<ContentWorkbookBatchBlockedFailure | null>(null);
  const [batchAllSkippedFailure, setBatchAllSkippedFailure] =
    useState<ContentWorkbookBatchAllSkippedFailure | null>(null);
  const [batchResult, setBatchResult] =
    useState<ContentWorkbookBatchResult | null>(null);
  const [batchBusy, setBatchBusy] = useState<"preview" | "commit" | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchIdempotencyKey, setBatchIdempotencyKey] = useState<string | null>(null);
  const [batchDiffAcknowledged, setBatchDiffAcknowledged] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const observerJobIdRef = useRef<string | null>(null);
  const resultHeadingRef = useRef<HTMLDivElement | null>(null);
  const marketplaceIdRef = useRef(marketplaceId);
  marketplaceIdRef.current = marketplaceId;
  const initialJobReconnectRevision = standaloneAuditReconnectRevision(initialJob);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    abortRef.current?.abort();
    setReply(null);
    setJob(null);
    setExporting(null);
    const matchingJob = initialJob?.kind === "content" &&
        initialJob.marketplaceId === marketplaceId &&
        initialJob.mode === mode
      ? initialJob
      : null;
    setError(matchingJob?.ready && matchingJob.status !== "completed"
      ? matchingJob.error.message
      : null);
    if (
      cachedResult?.snapshot.marketplaceId === marketplaceId &&
      standaloneAuditSnapshotMatchesJob(cachedResult.snapshot, matchingJob)
    ) {
      setState("done");
      setSnapshot(cachedResult.snapshot);
      setFilter(cachedResult.filter);
      setQuery(cachedResult.query);
      setSpellcheckNote(cachedResult.spellcheckNote);
      return;
    }
    setState("idle");
    setSnapshot(null);
    setFilter("all");
    setQuery("");
    setSpellcheckNote(null);
  }, [cachedResult, initialJobReconnectRevision, marketplaceId, mode]);

  useEffect(() => {
    setWorkbookFile(null);
    setBatchPreview(null);
    setBatchFailure(null);
    setBatchBlockedFailure(null);
    setBatchAllSkippedFailure(null);
    setBatchResult(null);
    setBatchBusy(null);
    setBatchError(null);
    setBatchIdempotencyKey(null);
    setBatchDiffAcknowledged(false);
  }, [marketplaceId, mode]);

  const attentionRows = useMemo(
    () =>
      snapshot ? contentAuditAttentionRows(snapshot) : [],
    [snapshot],
  );
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    return (snapshot?.rows ?? []).filter((row) => {
      if (!contentAuditRowMatchesFilter(row, filter)) return false;
      if (!normalizedQuery) return true;
      return [
        row.sellerSku,
        row.asin,
        row.title,
        row.itemHighlight ?? "",
        row.productDescription ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery);
    });
  }, [snapshot, filter, query]);
  const invisibleLocations = useMemo(
    () =>
      filter === "all" || filter === "SUSPECTED_TYPO"
        ? locateInvisibleCharacters(visibleRows)
        : [],
    [filter, visibleRows],
  );

  const loadAudit = async (
    completedJob: StandaloneAuditJob,
    signal: AbortSignal,
  ) => {
    if (!completedJob.ready || completedJob.status !== "completed") {
      throw new Error(
        completedJob.ready
          ? completedJob.error.message
          : "文案健檢背景工作尚未完成。",
      );
    }
    setState("scanning");
    const base = parseContentAuditSnapshot(
      completedJob.snapshot,
      marketplaceIdRef.current,
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const editableRows = base.rows;
    const rows = editableRows;
    const parentNote =
      "Amazon relationships 已在 Notebook 鑰匙背景工作中核對；已證明的 parent 容器不列為文案錯誤，也不提供編輯。";
    let nextSpellcheckNote: string;
    try {
      const spelling = await import("../../../shared/content-spelling-metadata");
      nextSpellcheckNote =
        `${parentNote}${parentNote ? " " : ""}AMZ.API 共用美式英文辭典 ${spelling.CONTENT_SPELLING_DICTIONARY_VERSION}（${spelling.CONTENT_SPELLING_DICTIONARY_LANGUAGE}）由 Notebook 鑰匙主程式產生可匯出快照，並保留 ${spelling.CONTENT_SPELLING_ALLOWLIST_COUNT.toLocaleString()} 項品牌、成分與 Amazon 合法字詞。介面只顯示快照中已有的提示，不會另外重算或自動改字。`;
    } catch {
      nextSpellcheckNote =
        `${parentNote}${parentNote ? " " : ""}共用英文辭典版本說明目前無法載入；Notebook 鑰匙主程式回傳的可匯出快照仍是唯一結果來源，介面不會另外重算或冒充其他拼字檢查。`;
    }
    const completed = {
      ...base,
      rows,
      readErrors: rows.flatMap((row) => row.readErrors.map((readError) => ({
        sellerSku: row.sellerSku,
        ...readError,
      }))),
      summary: summarizeContentAudit(rows),
    };
    setSnapshot(completed);
    setFilter("all");
    setQuery("");
    setSpellcheckNote(nextSpellcheckNote);
    setState("done");
    onCachedResultChange?.({
      snapshot: completed,
      filter: "all",
      query: "",
      spellcheckNote: nextSpellcheckNote,
    });
  };

  const startAudit = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("starting");
    setReply(null);
    setError(null);
    setSnapshot(null);
    setFilter("all");
    setQuery("");
    setSpellcheckNote(null);
    setWorkbookFile(null);
    setBatchPreview(null);
    setBatchFailure(null);
    setBatchBlockedFailure(null);
    setBatchAllSkippedFailure(null);
    setBatchResult(null);
    try {
      let current = await startStandaloneAuditJob({
        kind: "content",
        marketplaceId,
        mode,
        signal: controller.signal,
      });
      observerJobIdRef.current = current.jobId;
      setJob(current);
      onJobChange?.(current);
      setState("polling");
      current = await pollStandaloneAuditJob({
        expected: current,
        signal: controller.signal,
        onProgress: (next) => {
          setJob(next);
          onJobChange?.(next);
        },
      });
      setJob(current);
      onJobChange?.(current);
      await loadAudit(current, controller.signal);
      observerJobIdRef.current = null;
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setState("idle");
      setError(
        requestError instanceof Error ? requestError.message : "目前無法完成文案健檢。",
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (!shouldResumeStandaloneAuditJob({
      initialJob,
      expectedKind: "content",
      marketplaceId,
      mode,
      observerJobId: observerJobIdRef.current,
    })) return;
    const observedJob = initialJob!;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    observerJobIdRef.current = observedJob.jobId;
    setJob(observedJob);
    setState(observedJob.ready ? "scanning" : "polling");
    void (async () => {
      try {
        const terminal = observedJob.ready
          ? observedJob
          : await pollStandaloneAuditJob({
              expected: observedJob,
              signal: controller.signal,
              onProgress: (next) => {
                setJob(next);
                onJobChange?.(next);
              },
            });
        setJob(terminal);
        onJobChange?.(terminal);
        await loadAudit(terminal, controller.signal);
      } catch (resumeError) {
        if (resumeError instanceof Error && resumeError.name === "AbortError") return;
        setState("idle");
        setError(resumeError instanceof Error
          ? resumeError.message
          : "目前無法接續文案健檢。");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          observerJobIdRef.current = null;
        }
      }
    })();
    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
      }
    };
  // The job identity is the reconnect boundary; local filter/query changes must not restart it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobReconnectRevision, marketplaceId, mode]);

  const statusText = job && !job.ready
    ? job.progress.message
    : scanStatusText(state, reply);
  const summary = snapshot?.summary;
  const summaryFilters: Array<{
    filter: AuditFilter;
    label: string;
    count: number;
    detail: string;
  }> = summary
    ? [
        {
          filter: "NEEDS_CORRECTION",
          label: "需修正",
          count: snapshot.rows.filter(contentAuditNeedsCorrection).length,
          detail: "名稱、亮點、要點或敘述",
        },
        { filter: "SUSPECTED_TYPO", label: "疑似錯字", count: summary.suspectedTypos, detail: "SKU" },
        { filter: "MISSING_INGREDIENTS", label: "缺成分", count: summary.missingIngredients, detail: "已證明適用的 SKU" },
        { filter: "SINGLE_INGREDIENT_MISMATCH", label: "成分宣稱不一致", count: summary.singleIngredientMismatch, detail: "依 ingredients 明確證據核對" },
        {
          filter: "CORRECT",
          label: "正確設定",
          count: snapshot.rows.filter((row) =>
            contentAuditRowMatchesFilter(row, "CORRECT")).length,
          detail: "全部檢查通過",
        },
        {
          filter: "READ_INCOMPLETE",
          label: "讀取未完成",
          count: snapshot.rows.filter(contentAuditReadIncomplete).length,
          detail: "含成分未驗證",
        },
      ]
    : [];

  const changeFilter = (nextFilter: AuditFilter, scrollToResults = false) => {
    setFilter(nextFilter);
    if (snapshot) {
      onCachedResultChange?.({
        snapshot,
        filter: nextFilter,
        query,
        spellcheckNote,
      });
    }
    if (scrollToResults) {
      window.requestAnimationFrame(() => {
        resultHeadingRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  };

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    if (snapshot) {
      onCachedResultChange?.({
        snapshot,
        filter,
        query: nextQuery,
        spellcheckNote,
      });
    }
  };

  const exportWorkbook = async (scope: "attention" | "all") => {
    const rowCount = scope === "all" ? snapshot?.rows.length : attentionRows.length;
    if (!snapshot || !snapshot.exportId || !rowCount || exporting) {
      return;
    }
    setExporting(scope);
    setError(null);
    try {
      const response = await fetch(
        contentAuditWorkbookDownloadUrl(
          marketplaceId,
          snapshot.exportId,
          scope,
        ),
        { cache: "no-store" },
      );
      if (!response.ok) {
        let message = "文案健檢 Excel 下載失敗，請重新掃描。";
        try {
          message = problemMessage(
            (await response.json()) as ApiProblem,
            message,
          );
        } catch {
          // A failed binary response is not guaranteed to contain JSON.
        }
        throw new Error(message);
      }
      assertContentAuditWorkbookDownloadEvidence(response, scope, rowCount);
      await downloadApiWorkbookResponse(
        response,
        auditExportFilename({
          kind: "content",
          marketplaceShort,
          fetchedAt: snapshot.fetchedAt,
        }),
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "文案健檢 Excel 下載失敗，請重新掃描。",
      );
    } finally {
      setExporting(null);
    }
  };

  const selectWorkbook = (file: File | null) => {
    setWorkbookFile(file);
    setBatchPreview(null);
    setBatchFailure(null);
    setBatchBlockedFailure(null);
    setBatchAllSkippedFailure(null);
    setBatchResult(null);
    setBatchError(null);
    setBatchIdempotencyKey(null);
    setBatchDiffAcknowledged(false);
  };

  const previewWorkbookImport = async () => {
    if (!workbookFile || batchBusy) return;
    if (!/\.xlsx$/iu.test(workbookFile.name)) {
      setBatchError("只接受由 AMZ.API 匯出的 .xlsx 文案健檢檔。");
      return;
    }
    const nextKey = `content-${crypto.randomUUID()}`;
    setBatchBusy("preview");
    setBatchError(null);
    setBatchPreview(null);
    setBatchFailure(null);
    setBatchBlockedFailure(null);
    setBatchAllSkippedFailure(null);
    setBatchResult(null);
    setBatchDiffAcknowledged(false);
    try {
      const form = new FormData();
      form.set("marketplaceId", marketplaceId);
      form.set("idempotencyKey", nextKey);
      form.set("file", workbookFile);
      const response = await fetch("/api/sp-api/listing-content/import", {
        method: "POST",
        body: form,
      });
      const raw = (await response.json()) as unknown;
      if (!response.ok) {
        const code = raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>).code
          : null;
        if (code === "CONTENT_BATCH_VALIDATION_FAILED") {
          setBatchFailure(parseContentWorkbookBatchFailure(raw));
          return;
        }
        if (code === "CONTENT_READ_INCOMPLETE") {
          setBatchBlockedFailure(
            parseContentWorkbookBatchBlockedFailure(raw),
          );
          return;
        }
        if (code === "CONTENT_BATCH_ALL_SKIPPED") {
          setBatchAllSkippedFailure(
            parseContentWorkbookBatchAllSkippedFailure(raw),
          );
          return;
        }
        throw new Error(problemMessage(raw as ApiProblem, "Excel 預檢失敗。"));
      }
      const parsed = parseContentWorkbookBatchPreview(raw, marketplaceId);
      setBatchIdempotencyKey(nextKey);
      setBatchPreview(parsed);
      setBatchDiffAcknowledged(false);
    } catch (requestError) {
      setBatchError(
        requestError instanceof Error
          ? requestError.message
          : "目前無法預檢這份 Excel。",
      );
    } finally {
      setBatchBusy(null);
    }
  };

  const commitWorkbookImport = async () => {
    if (
      !batchPreview ||
      !batchIdempotencyKey ||
      batchBusy ||
      !batchDiffAcknowledged
    ) return;
    setBatchBusy("commit");
    setBatchError(null);
    try {
      const response = await fetch("/api/sp-api/listing-content/import", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contentWorkbookBatchCommitBody(
          batchPreview,
          marketplaceId,
          batchIdempotencyKey,
        )),
      });
      const raw = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(problemMessage(raw as ApiProblem, "Excel 批次更新失敗。"));
      }
      setBatchResult(parseContentWorkbookBatchResult(raw, marketplaceId));
      setBatchPreview(null);
      setBatchDiffAcknowledged(false);
    } catch (requestError) {
      setBatchError(
        requestError instanceof Error
          ? requestError.message
          : "目前無法完成 Excel 批次更新。",
      );
    } finally {
      setBatchBusy(null);
    }
  };

  return (
    <section className="content-audit-panel" aria-label="全站 FBA 文案健檢">
      <AuditDetailsDisclosure summary="文案門檻、英文辭典與 Excel 更新防呆">
        <div className="automation-summary compact">
          <span className="automation-badge automatic">自動</span><p>全站文案健檢會找出疑似錯字、賣點不足與缺成分；單一 SKU 會處理 PTD、舊值衝突與送出後回查。</p>
          <span className="automation-badge one_click">一鍵</span><p>文案健檢與 Excel 都會自動建立、輪詢；內容更新通過預檢後直接使用 Notebook 鑰匙（Touch ID／Windows Hello）。</p>
          <span className="automation-badge manual">需人工</span><p>疑似錯字、產品名稱、產品亮點、五大賣點、產品敘述與成分內容由你決定。</p>
        </div>
        <p className="price-intro">
          一次掃描所選站點全部 FBA SKU，先以 Amazon relationships 排除沒有可編輯文案的 parent 容器，再列出疑似錯字、少於五個賣點，以及有可靠商品類型證據但缺成分的商品。產品名稱少於 60、產品亮點少於 110、每項產品要點少於 150 或超過 200，以及產品敘述少於 1,800 個 Unicode 字元也會標示原因；成分宣稱會依 Amazon ingredients 明確證據核對多成分、Tendon／Tendons 與 Chicken／hypoallergenic，資料未完成時不推測。
        </p>
        <div className="content-export-note content-audit-privacy">
          <strong>Amazon 唯讀＋AMZ.API 共用英文辭典</strong>
          <p>美式英文辭典由 Mac／Windows Notebook Key Bridge 在本機套用，顯示與 Excel 共用同一份快照；文案不會送到第三方，疑似錯字仍由你判斷。</p>
        </div>
        <div className="content-export-note content-audit-batch-safety">
          <strong>Excel 批次更新安全流程</strong>
            <p>「待確認項目 Excel」或「全部商品文案完整模板」都可以選回來；只編輯淺綠或黃色的「更新…」欄位。第一步只做原值、站點、PTD 與 Amazon Validation Preview 核對，零寫入。只有通過 Amazon Validation Preview 且安全綁定一致的 SKU 才會進入 Touch ID／Windows Hello；INVALID 或其他單一 SKU 問題會隔離列出，其餘安全 SKU 繼續，結果不明的 SKU 絕不自動重送。</p>
        </div>
      </AuditDetailsDisclosure>
      {state === "done" && snapshot && summary && (
        <>
          <div className="content-audit-export-grid" aria-label="選擇文案 Excel 匯出範圍">
            <button
              className="content-audit-export-primary content-audit-export-attention"
              type="button"
              data-export-scope="attention"
              onClick={() => void exportWorkbook("attention")}
              disabled={attentionRows.length === 0 || !snapshot.exportId || Boolean(exporting)}
            >
              <span aria-hidden="true">待</span>
              <strong>{exporting === "attention"
                ? "正在匯出待確認清單…"
                : `待確認清單 · 匯出 ${attentionRows.length.toLocaleString()} 項 Excel`}</strong>
              <small>只含有問題或讀取未完成的商品</small>
            </button>
            <button
              className="content-audit-export-primary content-audit-export-all"
              type="button"
              data-export-scope="all"
              onClick={() => void exportWorkbook("all")}
              disabled={snapshot.rows.length === 0 || !snapshot.exportId || Boolean(exporting)}
            >
              <span aria-hidden="true">全</span>
              <strong>{exporting === "all"
                ? "正在匯出完整模板…"
                : `完整模板 · 匯出全部 ${snapshot.rows.length.toLocaleString()} 個商品 Excel`}</strong>
              <small>包含正常商品，可直接當批次更新模板</small>
            </button>
          </div>
          <p className="content-audit-export-local-note">兩份都只在這台電腦建立；任一份都可回傳更新。</p>
        </>
      )}
      {state === "done" && snapshot && summary && (
        <section className="content-audit-roundtrip" aria-label="回傳 Excel 批次更新文案">
          <div>
            <strong>回傳任一份 Excel 批次更新</strong>
            <p>可回傳完整檔，也可只保留 F007，或只保留 F007、F008；系統只讀取與預檢實際附上的工作表，其他商品完全不碰。請複製或保留整張工作表分頁，不要只複製儲存格。</p>
          </div>
          <ContentAuditWorkbookFilePicker
            fileName={workbookFile?.name ?? null}
            disabled={Boolean(batchBusy)}
            onSelect={selectWorkbook}
          />
          <button
            type="button"
            className="content-audit-roundtrip-preview"
            disabled={!workbookFile || Boolean(batchBusy) || Boolean(batchPreview)}
            onClick={() => void previewWorkbookImport()}
          >
            {batchBusy === "preview" ? "正在逐 SKU 預檢…" : "先預覽 Excel 變更（不寫入）"}
          </button>
          {batchError && <div className="price-error" role="alert">{batchError}</div>}
          {batchFailure && (
            <ContentWorkbookBatchFailureCard failure={batchFailure} />
          )}
          {batchBlockedFailure && (
            <ContentWorkbookBatchBlockedFailureCard
              failure={batchBlockedFailure}
            />
          )}
          {batchAllSkippedFailure && (
            <ContentWorkbookBatchAllSkippedFailureCard
              failure={batchAllSkippedFailure}
            />
          )}
          {batchPreview && (
            <ContentWorkbookBatchPreviewCard
              preview={batchPreview}
              busy={batchBusy === "commit"}
              acknowledged={batchDiffAcknowledged}
              onAcknowledgedChange={setBatchDiffAcknowledged}
              onCommit={() => void commitWorkbookImport()}
            />
          )}
          {batchResult && <ContentWorkbookBatchResultCard result={batchResult} />}
        </section>
      )}
      {error && <div className="price-error" role="alert">{error}</div>}
      {statusText && (
        <div className="validation-status demo" role="status" aria-live="polite">
          <strong>{statusText}</strong>
          {reply?.progress !== null && reply?.progress !== undefined && (
            <p>Amazon 報表進度 {Math.max(0, Math.min(100, Math.round(reply.progress)))}%</p>
          )}
        </div>
      )}
      {state !== "done" && (
        <button
          className="price-primary-button"
          type="button"
          onClick={() => void startAudit()}
          disabled={state !== "idle"}
        >
          {state === "idle" ? `掃描 ${marketplaceShort} 全部 FBA 文案` : "文案健檢進行中…"}
        </button>
      )}

      {state === "done" && snapshot && summary && (
        <>
          <div className="content-audit-summary" role="group" aria-label="文案健檢摘要與問題篩選">
            <article><span>完成讀取</span><strong>{summary.completed.toLocaleString()}</strong><small>共 {summary.total.toLocaleString()} 個可健檢 FBA SKU</small></article>
            {summaryFilters.map((item) => (
              <button
                key={item.filter}
                type="button"
                data-audit-filter={item.filter}
                className={filter === item.filter ? "active" : ""}
                aria-pressed={filter === item.filter}
                aria-label={`${item.label} ${item.count.toLocaleString()}，顯示對應商品`}
                onClick={() => changeFilter(item.filter, true)}
              >
                <span>{item.label}</span>
                <strong>{item.count.toLocaleString()}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
          {spellcheckNote && <p className="content-audit-note">{spellcheckNote}</p>}
          {invisibleLocations.length > 0 && (
            <aside
              className="content-export-note content-audit-invisible-guide"
              aria-label="不可見字元統一說明與位置"
            >
              <strong>不可見字元統一說明</strong>
              <p>
                代碼會完整寫成 U+200B；U+200B 是「零寬空格」，不是 U+200。
                下方紅色括號只是定位標記，不會修改原文；請手動修改標示段落。
              </p>
              <ul>
                {invisibleLocations.slice(0, 1).map((location, index) => (
                  <li
                    key={`${location.sellerSku}-${location.fieldLabel}-${location.codePoint}-${index}`}
                  >
                    <strong>
                      {location.sellerSku} · {location.fieldLabel} · {location.codePoint}（{location.name}）
                    </strong>
                    <code style={{ color: "#b42318", fontWeight: 700 }}>
                      {location.context}
                    </code>
                    <small>
                      位於「{location.before}」與「{location.after}」之間；應手動修改此段。
                    </small>
                  </li>
                ))}
              </ul>
              {invisibleLocations.length > 1 && (
                <details className="content-audit-invisible-more">
                  <summary>…另有 {invisibleLocations.length - 1} 筆</summary>
                  <ul>
                    {invisibleLocations.slice(1).map((location, index) => (
                      <li
                        key={`${location.sellerSku}-${location.fieldLabel}-${location.codePoint}-${index + 1}`}
                      >
                        <strong>
                          {location.sellerSku} · {location.fieldLabel} · {location.codePoint}（{location.name}）
                        </strong>
                        <code style={{ color: "#b42318", fontWeight: 700 }}>
                          {location.context}
                        </code>
                        <small>
                          位於「{location.before}」與「{location.after}」之間；應手動修改此段。
                        </small>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </aside>
          )}
          <div className="content-audit-controls">
            <label>
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                placeholder="搜尋 SKU、ASIN 或商品文案"
                aria-label="搜尋文案健檢結果"
              />
            </label>
          </div>
          <div className="content-audit-result-heading" ref={resultHeadingRef}>
            <strong>{visibleRows.length.toLocaleString()} 個符合條件的 SKU</strong>
            <div>
              <button type="button" onClick={() => void startAudit()}>重新掃描</button>
            </div>
          </div>
          {visibleRows.length ? (
            <div className="content-audit-list">
              {visibleRows.map((row) => {
                const titleIssues = typoIssuesForField(row, "title");
                const bulletIssues = typoIssuesForField(row, "bulletPoints");
                const ingredientsIssues = typoIssuesForField(row, "ingredients");
                const affectedBullets = row.bulletPoints
                  .map((value, index) => ({ value, index }))
                  .filter(({ value }) => hasHighlightedContent(value, bulletIssues));
                const quickEditAvailability = quickEditAvailabilityForRow(row);
                const quickEditFocus = quickEditAvailability.status === "ready"
                  ? quickEditAvailability.focus
                  : null;
                return (
                  <article key={row.sellerSku}>
                    <div className="content-audit-product">
                      <span>{(row.title || row.sellerSku).slice(0, 1)}</span>
                      <div>
                        <strong>
                          {row.title
                            ? highlightedContent(row.title, titleIssues)
                            : "尚無商品標題"}
                        </strong>
                        <small>{row.sellerSku}{row.asin ? ` · ${row.asin}` : ""}</small>
                      </div>
                      <div className="content-audit-edit-actions">
                        <button
                          type="button"
                          className="content-audit-fix-now"
                          onClick={() => {
                            if (quickEditFocus) onOpenSku(row.sellerSku, quickEditFocus);
                          }}
                          disabled={!quickEditFocus}
                          title={quickEditAvailability.status === "unavailable"
                            ? quickEditAvailability.unavailableReason
                            : "重新讀取 Amazon 後聚焦待修欄位，不會直接寫入。"}
                        >
                          立刻修改
                        </button>
                        <button type="button" onClick={() => onOpenSku(row.sellerSku)}>
                          完整編輯
                        </button>
                      </div>
                    </div>
                    {quickEditAvailability.status === "unavailable" && (
                      <p className="content-audit-quick-edit-unavailable" role="status">
                        立刻修改目前不可用：{quickEditAvailability.unavailableReason}
                      </p>
                    )}
                    {(affectedBullets.length > 0 ||
                      hasHighlightedContent(row.ingredients, ingredientsIssues)) && (
                      <div
                        className="content-audit-original-copy"
                        aria-label={`${row.sellerSku} 疑似錯字原文`}
                      >
                        {affectedBullets.map(({ value, index }) => (
                          <p key={`bullet-${index}`}>
                            <strong>賣點 {index + 1}</strong>
                            <span>{highlightedContent(value, bulletIssues)}</span>
                          </p>
                        ))}
                        {hasHighlightedContent(row.ingredients, ingredientsIssues) && (
                          <p>
                            <strong>成分</strong>
                            <span>{highlightedContent(row.ingredients, ingredientsIssues)}</span>
                          </p>
                        )}
                      </div>
                    )}
                    <div className="content-audit-issues" aria-label="待修原因">
                      {row.readStatus === "incomplete" &&
                        filter === "READ_INCOMPLETE" &&
                        row.readErrors.map((readError, index) => (
                          <div key={`${readError.code}-${index}`}>
                            <span className="kind-read_incomplete">讀取失敗／未完成</span>
                            <p>{readError.message}</p>
                            <small>本列未計入字數、缺賣點、缺成分或共用拼字統計</small>
                          </div>
                        ))}
                      {row.issues
                        .filter(
                          (issue) =>
                            !invisibleIssueIsExplained(
                              row,
                              issue,
                              invisibleLocations,
                            ) &&
                            contentAuditIssueMatchesFilter(issue, filter),
                        )
                        .map((issue, index) => (
                          <div key={`${issue.kind}-${issue.field}-${issue.bulletIndex ?? issue.token ?? index}`}>
                            <span className={`kind-${issue.kind.toLocaleLowerCase()}`}>{issueLabel(issue.kind)}</span>
                            <p>{issue.message}</p>
                            {issue.suggestion && <small>建議檢查：{issue.suggestion}</small>}
                          </div>
                        ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="content-audit-empty">
              <span>✓</span><strong>這個條件下沒有符合項目</strong><p>可切換篩選或清除搜尋文字。</p>
            </div>
          )}
        </>
      )}
      <p className="batch-footnote">每次健檢只處理所選站點可證明為 Amazon 配送的 FBA SKU；FBM 不會加入。</p>
    </section>
  );
}
