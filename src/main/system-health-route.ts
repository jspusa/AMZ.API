import type {
  ApiRequest,
  ApiResponse,
  CredentialSummary,
} from "../shared/contracts";
import {
  DEFAULT_MARKETPLACE_ID,
  type MarketplaceId,
} from "../shared/marketplaces";
import { MARKETPLACES } from "./amazon/sp-api";
import { parseMarketplace } from "./route-input";
import { invalid, json } from "./route-response";

type Check = {
  id: string;
  label: string;
  state: "ready" | "attention" | "manual";
  automation: "automatic" | "one_click" | "manual";
  detail: string;
  action: string | null;
};

export interface SystemHealthRoutePort {
  systemHealth(request: ApiRequest): Promise<ApiResponse>;
}

export type SystemHealthRouteDependencies = Readonly<{
  getCredentialSummary(): Promise<CredentialSummary>;
  usesDemoMode(marketplaceId: MarketplaceId): boolean;
  now?: () => Date;
}>;

function check(
  id: string,
  label: string,
  state: Check["state"],
  automation: Check["automation"],
  detail: string,
  action: string | null = null,
): Check {
  return { id, label, state, automation, detail, action };
}

/** Honest, local-only projection of AMZ.API readiness safeguards. */
export class SystemHealthRoute implements SystemHealthRoutePort {
  private readonly getCredentialSummary:
    SystemHealthRouteDependencies["getCredentialSummary"];
  private readonly usesDemoMode: SystemHealthRouteDependencies["usesDemoMode"];
  private readonly now: () => Date;

  constructor(input: SystemHealthRouteDependencies) {
    this.getCredentialSummary = input.getCredentialSummary;
    this.usesDemoMode = input.usesDemoMode;
    this.now = input.now ?? (() => new Date());
  }

  async systemHealth(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(
      request.query.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    );
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");
    const marketplace = MARKETPLACES[marketplaceId];
    const summary = await this.getCredentialSummary();
    const region = marketplace.region;
    const live = summary.regions[region].configured &&
      !this.usesDemoMode(marketplaceId);
    const checks: Check[] = [
      check(
        "fba-only",
        "FBA-only 守門",
        "ready",
        "automatic",
        "所有訂單、庫存與補貨查詢都固定為 Amazon 履約；沒有 FBM 操作入口。",
      ),
      check(
        "sp-api",
        "Amazon SP-API 憑證設定",
        live ? "ready" : "attention",
        "automatic",
        live
          ? `${marketplace.label}已設定本機系統安全儲存區中的 ${region.toUpperCase()} 憑證；本項只核對本機設定，未代表即時驗證 Amazon 連線。`
          : "尚未輸入此區域的 LWA、Refresh Token 與 Seller ID，目前使用展示資料。",
        live ? null : "開啟右上角本機安全連線，輸入 SP-API 憑證",
      ),
      check(
        "keychain",
        "本機系統安全儲存區加密",
        summary.encryptionAvailable ? "ready" : "attention",
        "automatic",
        summary.encryptionAvailable
          ? "Refresh Token 與 Client Secret 只以加密密文保存於這台電腦。"
          : "本機系統安全儲存區不可用；系統已拒絕保存任何 API 憑證。",
      ),
      check(
        "operation-ledger",
        "本機防重送帳本",
        "ready",
        "automatic",
        "已確認結果保留 24 小時；未確認寫入會持續鎖定，直到主程序唯讀回查證明完成，絕不盲目重送。",
      ),
      check(
        "product-master",
        "中央 SKU 商品主檔",
        "ready",
        "automatic",
        "箱入數、交期、AWD 緩衝與效期設定保存在這台電腦，所有補貨工具共用。",
      ),
      check(
        "image-storage",
        "圖片拖拉與公開來源",
        summary.imageStorageConfigured ? "ready" : "attention",
        "one_click",
        summary.imageStorageConfigured
          ? "圖片會在本機驗證後上傳到你自己的 R2 公開網域，再交由 Amazon 讀取。"
          : "本機拖拉與格式檢查可用；正式送出圖片前需設定自己的 R2 公開 HTTPS 網域。",
        summary.imageStorageConfigured
          ? null
          : "本機安全連線 → 圖片空間 → 加入 R2 設定",
      ),
      check(
        "replenishment-engine",
        "FBA 補貨引擎",
        "ready",
        "automatic",
        summary.replenishmentSkillConfigured
          ? "內建 FBA 計算已就緒，外部補貨 Skill 接點也已設定。"
          : "內建 FBA 庫存、在途與近 30 天銷速計算已就緒；外部 Skill 為選配。",
      ),
      check(
        "amazon-ads",
        "SB／SD 廣告授權",
        "manual",
        "manual",
        "Amazon Ads 需要獨立 Direct Advertiser、LWA client 與站點 Profile；SP 仍建議留在 Helium 10。",
        "一鍵開啟 Amazon Ads Console",
      ),
    ];
    const actionable = checks.filter((item) => item.state !== "manual");
    const readyCount = actionable.filter((item) => item.state === "ready").length;
    const attentionCount = actionable.length - readyCount;
    return json({
      marketplaceId,
      marketplaceLabel: marketplace.label,
      mode: live ? "live" : "demo",
      overall: attentionCount ? "attention" : "ready",
      checkedAt: this.now().toISOString(),
      score: Math.round((readyCount / Math.max(1, actionable.length)) * 100),
      summary: {
        ready: readyCount,
        attention: attentionCount,
        manual: checks.filter((item) => item.state === "manual").length,
      },
      checks,
      safeguards: [
        "本機 App 內部 IPC 白名單",
        "本機系統安全儲存區加密",
        "FBA-only 固定條件",
        "精確 Seller SKU 驗證",
        "Amazon Validation Preview",
        "舊值衝突檢查",
        "本機持久 Idempotency 防重送",
        "大幅調價二次確認",
        "Notebook 鑰匙（Touch ID／Windows Hello）系統確認",
        "送出後只讀回查，不自動重送",
      ],
      notice:
        "自我檢查只讀取本機設定狀態，未代表即時驗證 Amazon 連線；不會修改 Amazon、廣告或實體入庫。",
    });
  }
}
