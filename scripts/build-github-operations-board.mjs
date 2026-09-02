import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OPERATIONS_BOARD_LABEL = "operations-board";
export const OPERATIONS_BOARD_EXPIRY_LABEL = "operations-board-expiry";
export const OPERATIONS_BOARD_PROMOTION_LABEL = "operations-board-promotion";
export const OPERATIONS_BOARD_APPROVED_LABEL = "operations-board-approved";

const AUTHORIZED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const MAX_ISSUE_PAGES = 20;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MARKETPLACES = new Map([
  ["Amazon 美國 — ATVPDKIKX0DER", "ATVPDKIKX0DER"],
  ["Amazon 加拿大 — A2EUQ1WTGCTBG2", "A2EUQ1WTGCTBG2"],
  ["Amazon 英國 — A1F83G8C2ARO7P", "A1F83G8C2ARO7P"],
  ["Amazon 德國 — A1PA6795UKMFR9", "A1PA6795UKMFR9"],
  ["Amazon 日本 — A1VC38T7YXB528", "A1VC38T7YXB528"],
  ["Amazon 新加坡 — A19VAU5U5O7RUS", "A19VAU5U5O7RUS"],
  ["Amazon 澳洲 — A39IBJ37TRP1C6", "A39IBJ37TRP1C6"],
]);
const FORBIDDEN_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

function issueNumber(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 999_999_999_999) {
    throw new Error("Issue number is invalid.");
  }
  return value;
}

function itemId(number) {
  return `00000000-0000-4000-8000-${String(issueNumber(number)).padStart(12, "0")}`;
}

function cleanText(value, maximum, label, required = false) {
  if (typeof value !== "string") throw new Error(`${label}格式無效。`);
  const clean = value.replace(/\r\n?/gu, "\n").trim();
  if (clean === "_No response_") return required ? (() => { throw new Error(`${label}不可空白。`); })() : "";
  if ((required && !clean) || clean.length > maximum || FORBIDDEN_TEXT.test(clean)) {
    throw new Error(`${label}格式無效或超過長度上限。`);
  }
  return clean;
}

function calendarDate(value, label) {
  const clean = cleanText(value, 10, label, true);
  const match = DATE_PATTERN.exec(clean);
  if (!match) throw new Error(`${label}必須使用 YYYY-MM-DD。`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label}日期不存在。`);
  }
  return clean;
}

export function issueFormSections(body) {
  if (typeof body !== "string") return new Map();
  const sections = new Map();
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  let heading = null;
  let value = [];
  const commit = () => {
    if (heading) sections.set(heading, value.join("\n").trim());
  };
  for (const line of lines) {
    const match = /^###\s+(.+?)\s*$/u.exec(line);
    if (match) {
      commit();
      heading = match[1];
      value = [];
    } else if (heading) {
      value.push(line);
    }
  }
  commit();
  return sections;
}

function labelNames(issue) {
  if (!Array.isArray(issue.labels)) return new Set();
  return new Set(issue.labels.flatMap((label) => {
    if (typeof label === "string") return [label];
    return label && typeof label.name === "string" ? [label.name] : [];
  }));
}

function issueItem(issue) {
  if (!issue || typeof issue !== "object" || issue.pull_request || issue.state !== "open") {
    throw new Error("不是開放中的 Issue。");
  }
  if (!AUTHORIZED_ASSOCIATIONS.has(issue.author_association)) {
    throw new Error("建立者不是專案擁有者或協作者。");
  }
  const labels = labelNames(issue);
  if (!labels.has(OPERATIONS_BOARD_LABEL)) throw new Error("不是公布欄 Issue。");
  if (!labels.has(OPERATIONS_BOARD_APPROVED_LABEL)) throw new Error("公布欄 Issue 尚未核准。");
  const isExpiry = labels.has(OPERATIONS_BOARD_EXPIRY_LABEL);
  const isPromotion = labels.has(OPERATIONS_BOARD_PROMOTION_LABEL);
  if (isExpiry === isPromotion) throw new Error("公布欄類型標籤無效。");
  const sections = issueFormSections(issue.body);
  if (isExpiry) {
    const marketplace = cleanText(sections.get("Amazon 站點"), 80, "Amazon 站點", true);
    const marketplaceId = MARKETPLACES.get(marketplace);
    if (!marketplaceId) throw new Error("Amazon 站點不支援。");
    return {
      id: itemId(issue.number),
      type: "expiry",
      marketplaceId,
      sellerSku: cleanText(sections.get("Seller SKU"), 40, "Seller SKU", true),
      expiryDate: calendarDate(sections.get("人工效期"), "人工效期"),
      note: cleanText(sections.get("備註") ?? "", 500, "備註"),
    };
  }
  const countdown = cleanText(sections.get("首頁倒數"), 40, "首頁倒數", true);
  if (countdown !== "需要顯示倒數" && countdown !== "只顯示在月曆") {
    throw new Error("首頁倒數選項無效。");
  }
  return {
    id: itemId(issue.number),
    type: "promotion",
    date: calendarDate(sections.get("檔期日期"), "檔期日期"),
    title: cleanText(sections.get("促銷名稱"), 120, "促銷名稱", true),
    note: cleanText(sections.get("備註") ?? "", 500, "備註"),
    countdown: countdown === "需要顯示倒數",
  };
}

export function buildOperationsBoardSnapshot(issues, now = new Date()) {
  if (!Array.isArray(issues)) throw new Error("GitHub Issues 回應格式無效。");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("公布欄時間無效。");
  const items = [];
  const skipped = [];
  for (const issue of [...issues].sort((left, right) => Number(right?.number) - Number(left?.number))) {
    try {
      items.push(issueItem(issue));
    } catch (error) {
      if (labelNames(issue).has(OPERATIONS_BOARD_LABEL)) {
        skipped.push({
          number: Number.isSafeInteger(issue?.number) ? issue.number : null,
          reason: error instanceof Error ? error.message : "公布欄 Issue 無效。",
        });
      }
    }
    if (items.length >= 100) break;
  }
  items.reverse();
  return {
    snapshot: {
      schemaVersion: 1,
      revision: now.getTime(),
      updatedAt: now.toISOString(),
      items,
    },
    skipped,
  };
}

export async function fetchOperationsBoardIssues(
  repository,
  token,
  fetchImpl = fetch,
) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("GITHUB_REPOSITORY 格式無效。");
  }
  if (!token) throw new Error("GITHUB_TOKEN 未提供。");

  const issues = [];
  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repository}/issues`);
    url.searchParams.set("state", "open");
    url.searchParams.set(
      "labels",
      `${OPERATIONS_BOARD_LABEL},${OPERATIONS_BOARD_APPROVED_LABEL}`,
    );
    url.searchParams.set("per_page", "100");
    url.searchParams.set("sort", "created");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("page", String(page));
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "AMZ.API-operations-board-builder",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`GitHub Issues 讀取失敗（HTTP ${response.status}）。`);
    }
    const pageIssues = await response.json();
    if (!Array.isArray(pageIssues)) throw new Error("GitHub Issues 回應格式無效。");
    issues.push(...pageIssues);
    if (pageIssues.length < 100) return issues;
  }

  throw new Error("公布欄 Issue 數量超過安全分頁上限；保留上一版 Pages。");
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) throw new Error("GITHUB_TOKEN 未提供。");
  const issues = await fetchOperationsBoardIssues(repository, token);
  const { snapshot, skipped } = buildOperationsBoardSnapshot(issues);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = process.env.OPERATIONS_BOARD_OUTPUT ||
    resolve(root, "src/renderer/public/operations-board/v1.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
  for (const item of skipped) {
    process.stderr.write(`Skipped operations-board issue #${item.number ?? "?"}: ${item.reason}\n`);
  }
  process.stdout.write(`Built operations board with ${snapshot.items.length} item(s).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
