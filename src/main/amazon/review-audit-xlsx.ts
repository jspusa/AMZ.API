import { strToU8, zipSync } from "fflate";
import type {
  ReviewAuditRankedItem,
  ReviewAuditRow,
  ReviewAuditSnapshot,
  ReviewTopicEvidence,
} from "./review-audit";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAX_CELL_CHARACTERS = 32_767;

type Cell = {
  value: string | number | null;
  style?: 0 | 1 | 2 | 3 | 4;
};

type Sheet = {
  name: string;
  rows: Cell[][];
  widths: number[];
  freezeRow?: number;
};

export function createReviewAuditWorkbook(input: {
  marketplaceLabel: string;
  snapshot: ReviewAuditSnapshot;
}): Uint8Array {
  const marketplaceLabel = requiredText(input.marketplaceLabel, "marketplaceLabel", 120);
  validateSnapshot(input.snapshot);
  const sheets = [
    summarySheet(marketplaceLabel, input.snapshot),
    allNonParentAsinsSheet(input.snapshot.rows),
    rankingSheet(input.snapshot.topFivePositive, input.snapshot.bottomFiveNegative),
    topicSheet("正向主題", input.snapshot.rows, "positive"),
    topicSheet("負向主題", input.snapshot.rows, "negative"),
    incompleteSheet(
      input.snapshot.rows,
      input.snapshot.relationshipIncompleteRows,
    ),
  ];
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(sheets.length)),
    "_rels/.rels": strToU8(packageRelationships()),
    "docProps/app.xml": strToU8(appProperties(sheets.map(({ name }) => name))),
    "docProps/core.xml": strToU8(coreProperties(marketplaceLabel, input.snapshot.fetchedAt)),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships(sheets.length)),
    "xl/styles.xml": strToU8(styles()),
    "xl/workbook.xml": strToU8(workbookXml(sheets)),
  };
  sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });
  return zipSync(archive, { level: 6 });
}

function validateSnapshot(snapshot: ReviewAuditSnapshot): void {
  if (snapshot.schemaVersion !== 2) throw new TypeError("Unsupported review audit schema.");
  if (Number.isNaN(new Date(snapshot.fetchedAt).getTime())) {
    throw new TypeError("Review audit fetchedAt is invalid.");
  }
  if (
    snapshot.availability.fullReviewTextAvailable !== false ||
    snapshot.availability.averageProductRatingAvailable !== false ||
    snapshot.availability.totalReviewCountAvailable !== false ||
    snapshot.availability.nonParentFbaAsinsOnly !== true ||
    snapshot.availability.relationshipsEvidenceRequired !== true ||
    snapshot.availability.parentContainersExcluded !== true
  ) {
    throw new TypeError("Review audit capability boundary is invalid.");
  }
  const asins = new Set<string>();
  const verifiedSellerSkus = new Set<string>();
  snapshot.rows.forEach((row, index) => {
    if (!/^[A-Z0-9]{10}$/u.test(row.asin) || asins.has(row.asin)) {
      throw new TypeError(`rows[${index}].asin is invalid or duplicated.`);
    }
    asins.add(row.asin);
    if (!row.sellerSkus.length || row.sellerSkus.some((sku) => !validSku(sku))) {
      throw new TypeError(`rows[${index}].sellerSkus is invalid.`);
    }
    if (
      row.relationshipRole !== "child" &&
      row.relationshipRole !== "standalone"
    ) {
      throw new TypeError(`rows[${index}].relationshipRole is invalid.`);
    }
    for (const sellerSku of row.sellerSkus) {
      if (verifiedSellerSkus.has(sellerSku)) {
        throw new TypeError(`rows[${index}].sellerSkus is duplicated.`);
      }
      verifiedSellerSkus.add(sellerSku);
    }
    requiredText(row.title, `rows[${index}].title`);
    if (
      row.averageProductRating !== null ||
      row.totalReviewCount !== null ||
      row.fullReviewTextAvailable !== false
    ) {
      throw new TypeError(`rows[${index}] invents unavailable review metrics.`);
    }
    for (const [polarity, topics] of [
      ["positiveTopics", row.positiveTopics],
      ["negativeTopics", row.negativeTopics],
    ] as const) {
      if (topics.length > 10) throw new TypeError(`rows[${index}].${polarity} is too long.`);
      topics.forEach((topic, topicIndex) => validateTopic(topic, `${polarity}[${topicIndex}]`));
    }
    if (row.status === "INCOMPLETE" && !row.incompleteReason) {
      throw new TypeError(`rows[${index}] is incomplete without a reason.`);
    }
    if (row.status !== "INCOMPLETE" && row.incompleteReason) {
      throw new TypeError(`rows[${index}] has an unexpected incomplete reason.`);
    }
  });
  const relationshipSellerSkus = new Set<string>();
  snapshot.relationshipIncompleteRows.forEach((row, index) => {
    if (
      !validSku(row.sellerSku) ||
      verifiedSellerSkus.has(row.sellerSku) ||
      relationshipSellerSkus.has(row.sellerSku) ||
      typeof row.asin !== "string" ||
      row.asin !== row.asin.trim() ||
      row.asin.length > 40 ||
      /[\u0000-\u001f\u007f]/u.test(row.asin)
    ) {
      throw new TypeError(
        `relationshipIncompleteRows[${index}] identity is invalid.`,
      );
    }
    relationshipSellerSkus.add(row.sellerSku);
    requiredText(row.title, `relationshipIncompleteRows[${index}].title`);
    requiredText(row.code, `relationshipIncompleteRows[${index}].code`, 120);
    requiredText(row.message, `relationshipIncompleteRows[${index}].message`);
    if (row.requestId !== null) {
      requiredText(
        row.requestId,
        `relationshipIncompleteRows[${index}].requestId`,
        200,
      );
    }
  });
  for (const item of [...snapshot.topFivePositive, ...snapshot.bottomFiveNegative]) {
    if (
      !asins.has(item.asin) ||
      item.metricLabel !== "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT"
    ) {
      throw new TypeError("Ranking references an unknown ASIN or metric.");
    }
  }
  const summary = snapshot.summary;
  const feedbackIncomplete = snapshot.rows.filter(
    ({ status }) => status === "INCOMPLETE",
  ).length;
  if (
    summary.uniqueFbaNonParentAsins !== snapshot.rows.length ||
    summary.verifiedNonParentListings !== verifiedSellerSkus.size ||
    summary.verifiedNonParentListings !==
      summary.verifiedChildListings + summary.verifiedStandaloneListings ||
    summary.sourceFbaListings !==
      summary.verifiedNonParentListings +
        summary.excludedParentContainers + summary.relationshipIncomplete ||
    summary.relationshipIncomplete !== relationshipSellerSkus.size ||
    summary.feedbackIncomplete !== feedbackIncomplete ||
    summary.totalIncomplete !== feedbackIncomplete + relationshipSellerSkus.size ||
    summary.incomplete !== summary.totalIncomplete ||
    summary.duplicateSkuAsinsCollapsed !==
      summary.verifiedNonParentListings - snapshot.rows.length
  ) {
    throw new TypeError("Review audit coverage summary is inconsistent.");
  }
}

function validateTopic(topic: ReviewTopicEvidence, label: string): void {
  requiredText(topic.topic, `${label}.topic`, 300);
  if (!Number.isSafeInteger(topic.numberOfMentions) || topic.numberOfMentions < 0) {
    throw new TypeError(`${label}.numberOfMentions is invalid.`);
  }
  if (
    !Number.isFinite(topic.occurrencePercentage) ||
    topic.occurrencePercentage < 0 ||
    topic.occurrencePercentage > 100 ||
    !Number.isFinite(topic.starRatingImpact)
  ) {
    throw new TypeError(`${label} metrics are invalid.`);
  }
  topic.reviewSnippets.forEach((snippet, index) =>
    requiredText(snippet, `${label}.reviewSnippets[${index}]`, 1_000),
  );
}

function summarySheet(marketplaceLabel: string, snapshot: ReviewAuditSnapshot): Sheet {
  const rows: Cell[][] = [
    [title("評論健檢（公開 Customer Feedback API）")],
    [text("站點"), text(marketplaceLabel)],
    [text("產生時間"), text(snapshot.fetchedAt)],
    [text("資料範圍"), warning("僅限全商品報表證明 FBA，且 Listings relationships 證明為 child 或 standalone 的非 parent ASIN。")],
    [text("排名指標"), text("非 parent ASIN 評論主題影響值（starRatingImpact），不是商品總星等或 1–5 星制。")],
    [text("負值含義"), warning("負數是此負向主題對星等下降方向的影響值，不是商品負星等；工作簿保留 Amazon 原始正負號與數值，不轉成 0 或絕對值。")],
    [text("公開 API 不提供"), warning("完整 review 全文、商品平均星等、總評論數。")],
    [text("官方來源"), text(snapshot.availability.officialSource)],
    [],
    [header("FBA 來源 SKU"), header("已驗證非 parent SKU"), header("唯一非 parent ASIN"), header("Child SKU"), header("Standalone SKU"), header("已排除 parent"), header("關係未完成"), header("評論查詢未完成"), header("已合併重複 SKU-ASIN")],
    [number(snapshot.summary.sourceFbaListings), number(snapshot.summary.verifiedNonParentListings), number(snapshot.summary.uniqueFbaNonParentAsins), number(snapshot.summary.verifiedChildListings), number(snapshot.summary.verifiedStandaloneListings), number(snapshot.summary.excludedParentContainers), number(snapshot.summary.relationshipIncomplete), number(snapshot.summary.feedbackIncomplete), number(snapshot.summary.duplicateSkuAsinsCollapsed)],
    [],
    [warning(snapshot.notice)],
  ];
  return { name: "說明", rows, widths: [28, 32, 24, 20, 22, 20, 22, 24, 26] };
}

function allNonParentAsinsSheet(rows: readonly ReviewAuditRow[]): Sheet {
  const output: Cell[][] = [[
    header("狀態"),
    header("Seller SKU"),
    header("非 parent ASIN"),
    header("關係角色"),
    header("商品名稱"),
    header("資料開始"),
    header("資料結束"),
    header("最強正向主題"),
    header("正向主題影響值"),
    header("正向提及數"),
    header("最強負向主題"),
    header("負向主題影響值"),
    header("負向提及數"),
    header("完整 review 全文"),
    header("商品總星等"),
    header("商品總評論數"),
    header("未完成原因"),
  ]];
  for (const row of rows) {
    const positive = row.positiveTopics[0] ?? null;
    const negative = row.negativeTopics[0] ?? null;
    output.push([
      text(statusLabel(row.status), row.status === "INCOMPLETE" ? 4 : 0),
      text(row.sellerSkus.join(" | ")),
      text(row.asin),
      text(row.relationshipRole === "child" ? "Child" : "Standalone"),
      text(row.title),
      text(row.dateRange?.startDate ?? ""),
      text(row.dateRange?.endDate ?? ""),
      text(positive?.topic ?? ""),
      number(positive?.starRatingImpact ?? null, 2),
      number(positive?.numberOfMentions ?? null),
      text(negative?.topic ?? ""),
      number(negative?.starRatingImpact ?? null, 3),
      number(negative?.numberOfMentions ?? null),
      warning("公開 API 不提供"),
      warning("公開 API 不提供"),
      warning("公開 API 不提供"),
      text(row.incompleteReason?.message ?? "", row.incompleteReason ? 4 : 0),
    ]);
  }
  return {
    name: "全部非ParentASIN",
    rows: output,
    widths: [14, 26, 18, 16, 55, 24, 24, 28, 18, 14, 28, 18, 14, 22, 22, 22, 55],
    freezeRow: 1,
  };
}

function rankingSheet(
  positive: readonly ReviewAuditRankedItem[],
  negative: readonly ReviewAuditRankedItem[],
): Sheet {
  const columns = ["排名", "Seller SKU", "非 parent ASIN", "商品名稱", "主題", "主題影響值", "提及數", "出現比例", "指標"];
  const rows: Cell[][] = [
    [title("前五名：最強正向主題")],
    columns.map(header),
    ...positive.map((item, index) => rankingRow(index + 1, item, 2)),
    [],
    [title("後五名：最強負向主題")],
    columns.map(header),
    ...negative.map((item, index) => rankingRow(index + 1, item, 3)),
    [],
    [warning("「前／後」依非 parent ASIN 主題 starRatingImpact 原始值排序，不是商品平均星等、1–5 星制或評論數；負數是星等下降方向的影響值，不是商品負星等。")],
  ];
  return { name: "前後五名", rows, widths: [10, 26, 15, 55, 28, 18, 14, 16, 34] };
}

function rankingRow(rank: number, item: ReviewAuditRankedItem, style: 2 | 3): Cell[] {
  return [
    number(rank),
    text(item.sellerSkus.join(" | ")),
    text(item.asin),
    text(item.title),
    text(item.topic, style),
    number(item.starRatingImpact, style),
    number(item.numberOfMentions),
    number(item.occurrencePercentage),
    text("非 parent ASIN 主題影響值"),
  ];
}

function topicSheet(
  name: "正向主題" | "負向主題",
  rows: readonly ReviewAuditRow[],
  polarity: "positive" | "negative",
): Sheet {
  const output: Cell[][] = [[
    header("Seller SKU"),
    header("非 parent ASIN"),
    header("商品名稱"),
    header("主題順位"),
    header("主題"),
    header("提及數"),
    header("出現比例 %"),
    header("主題影響值"),
    header("官方評論短句證據"),
  ]];
  for (const row of rows) {
    const topics = polarity === "positive" ? row.positiveTopics : row.negativeTopics;
    topics.forEach((topic, index) => output.push([
      text(row.sellerSkus.join(" | ")),
      text(row.asin),
      text(row.title),
      number(index + 1),
      text(topic.topic, polarity === "positive" ? 2 : 3),
      number(topic.numberOfMentions),
      number(topic.occurrencePercentage),
      number(topic.starRatingImpact, polarity === "positive" ? 2 : 3),
      text(topic.reviewSnippets.join("\n")),
    ]));
  }
  return {
    name,
    rows: output,
    widths: [26, 15, 55, 12, 30, 14, 16, 18, 65],
    freezeRow: 1,
  };
}

function incompleteSheet(
  rows: readonly ReviewAuditRow[],
  relationshipRows: ReviewAuditSnapshot["relationshipIncompleteRows"],
): Sheet {
  const output: Cell[][] = [[
    header("階段"),
    header("Seller SKU"),
    header("ASIN"),
    header("商品名稱"),
    header("代碼"),
    header("說明"),
    header("Amazon request ID"),
  ]];
  for (const row of rows) {
    if (!row.incompleteReason) continue;
    output.push([
      text("評論主題查詢", 4),
      text(row.sellerSkus.join(" | ")),
      text(row.asin),
      text(row.title),
      text(row.incompleteReason.code, 4),
      text(row.incompleteReason.message, 4),
      text(row.incompleteReason.requestId ?? ""),
    ]);
  }
  for (const row of relationshipRows) {
    output.push([
      text("Listings relationships", 4),
      text(row.sellerSku),
      text(row.asin),
      text(row.title),
      text(row.code, 4),
      text(row.message, 4),
      text(row.requestId ?? ""),
    ]);
  }
  output.push([], [warning("關係證據未完成列不會呼叫 Customer Feedback；評論查詢未完成列不代表零評論。兩者都不會放入前／後五名。")]);
  return { name: "未完成", rows: output, widths: [24, 26, 18, 55, 38, 70, 38], freezeRow: 1 };
}

function statusLabel(status: ReviewAuditRow["status"]): string {
  if (status === "COMPLETE") return "已取得主題";
  if (status === "NO_TOPICS") return "Amazon 無主題";
  return "未完成";
}

function validSku(value: string): boolean {
  return Boolean(value && value.length <= 40 && !/[\u0000-\u001f\u007f]/u.test(value));
}

function requiredText(value: unknown, label: string, maximum = 5_000): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) throw new TypeError(`${label} is invalid.`);
  return value;
}

function title(value: string): Cell { return { value, style: 1 }; }
function header(value: string): Cell { return { value, style: 1 }; }
function warning(value: string): Cell { return { value, style: 4 }; }
function text(value: string, style: 0 | 1 | 2 | 3 | 4 = 0): Cell {
  return { value, style };
}
function number(value: number | null, style: 0 | 1 | 2 | 3 | 4 = 0): Cell {
  return { value, style };
}

function worksheetXml(sheet: Sheet): string {
  const maxColumns = Math.max(sheet.widths.length, ...sheet.rows.map((row) => row.length));
  const dimension = sheet.rows.length
    ? `A1:${columnName(maxColumns)}${sheet.rows.length}`
    : "A1";
  const columns = sheet.widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join("");
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => cellXml(cell, rowIndex + 1, columnIndex + 1)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const frozen = sheet.freezeRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRow}" topLeftCell="A${sheet.freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "<sheetViews><sheetView workbookViewId=\"0\"/></sheetViews>";
  const autoFilter = sheet.freezeRow === 1 && sheet.rows.length > 1
    ? `<autoFilter ref="A1:${columnName(maxColumns)}${sheet.rows.length}"/>`
    : "";
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${dimension}"/>${frozen}<cols>${columns}</cols><sheetData>${rows}</sheetData>${autoFilter}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" pageOrder="downThenOver" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function cellXml(cell: Cell, row: number, column: number): string {
  const reference = `${columnName(column)}${row}`;
  const style = cell.style ?? 0;
  if (typeof cell.value === "number") {
    if (!Number.isFinite(cell.value)) throw new TypeError(`Cell ${reference} is not finite.`);
    return `<c r="${reference}" s="${style}"><v>${cell.value}</v></c>`;
  }
  const value = safeCellText(cell.value ?? "");
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function safeCellText(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
    .slice(0, MAX_CELL_CHARACTERS);
  return /^[=+\-@]/u.test(normalized) ? `'${normalized}` : normalized;
}

function columnName(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
}

function contentTypes(sheetCount: number): string {
  const worksheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheets}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function packageRelationships(): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function workbookRelationships(sheetCount: number): string {
  const worksheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function workbookXml(sheetDefinitions: readonly Sheet[]): string {
  const sheets = sheetDefinitions.map(({ name }, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join("");
  const printTitles = sheetDefinitions.flatMap(({ name, freezeRow }, index) =>
    freezeRow
      ? [`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${escapeXml(name.replace(/'/gu, "''"))}'!$1:$${freezeRow}</definedName>`]
      : [],
  ).join("");
  const definedNames = printTitles ? `<definedNames>${printTitles}</definedNames>` : "";
  return `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets>${definedNames}</workbook>`;
}

function styles(): string {
  return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font><font><color rgb="FF26734D"/><sz val="11"/><name val="Aptos"/></font><font><color rgb="FFB42318"/><sz val="11"/><name val="Aptos"/></font><font><color rgb="FF8A4B08"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF23364D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function appProperties(names: readonly string[]): string {
  return `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AMZ.API</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${names.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts></Properties>`;
}

function coreProperties(marketplaceLabel: string, fetchedAt: string): string {
  const created = new Date(fetchedAt).toISOString();
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(`Amazon FBA 評論主題健檢 - ${marketplaceLabel}`)}</dc:title><dc:creator>AMZ.API</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
}
