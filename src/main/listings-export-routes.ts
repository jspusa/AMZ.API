import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { ContentAuditOwnerPort } from
  "./amazon/content-audit-owner";
import type { ImageAuditOwnerPort } from "./amazon/image-audit-owner";
import type { ListingsExportPort } from "./amazon/listings-export";
import {
  bodyRecord,
  parseMarketplace,
  reportIdentifier,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";

export interface ListingsExportRoutesPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  observe(request: ApiRequest): Promise<ApiResponse>;
}

export type ListingsExportRouteOwnerPort = Pick<
  ListingsExportPort,
  "start" | "status" | "capture" | "download"
>;

export type ContentAuditRouteOwnerPort = Pick<
  ContentAuditOwnerPort,
  "captureFromListings" | "download"
>;

export type ImageAuditRouteOwnerPort = Pick<
  ImageAuditOwnerPort,
  "captureFromListings" | "download"
>;

export type ListingsExportRoutesDependencies = Readonly<{
  listingsExport: ListingsExportRouteOwnerPort;
  contentAudit: ContentAuditRouteOwnerPort;
  imageAudit: ImageAuditRouteOwnerPort;
}>;

/**
 * Renderer-facing owner for the explicit Listings export route pair.
 * Report transport, snapshot retention, audit projection, and workbook
 * generation stay closed behind the three injected semantic owners.
 */
export class ListingsExportRoutes implements ListingsExportRoutesPort {
  private readonly listingsExport: ListingsExportRouteOwnerPort;
  private readonly contentAudit: ContentAuditRouteOwnerPort;
  private readonly imageAudit: ImageAuditRouteOwnerPort;

  constructor(input: ListingsExportRoutesDependencies) {
    this.listingsExport = input.listingsExport;
    this.contentAudit = input.contentAudit;
    this.imageAudit = input.imageAudit;
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要匯出的 Amazon 站點。");
    }
    try {
      const status = await this.listingsExport.start({ marketplaceId });
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return routeError(error, "開始建立全商品 Excel 時發生未預期的錯誤。");
    }
  }

  async observe(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const auditRequested = request.query.audit === "1";
    const imageAuditRequested = request.query.imageAudit === "1";
    if (!marketplaceId) return invalid("報表站點資訊無效，請重新匯出。");
    if (auditRequested && imageAuditRequested) {
      return invalid("一次只能執行一種全站健檢。");
    }
    if (auditRequested && request.query.download === "1") {
      const exportId = reportIdentifier(request.query.exportId);
      if (!exportId) {
        return invalid("文案健檢 Excel 快照資訊無效，請重新掃描。");
      }
      const scope = request.query.scope || "attention";
      if (scope !== "attention" && scope !== "all") {
        return invalid("文案健檢 Excel 匯出範圍無效，請重新選擇。");
      }
      try {
        return await this.contentAudit.download({ marketplaceId, exportId, scope });
      } catch (error) {
        return routeError(error, "建立文案健檢 Excel 時發生未預期的錯誤。");
      }
    }
    if (imageAuditRequested && request.query.download === "1") {
      const exportId = reportIdentifier(request.query.exportId);
      if (!exportId) {
        return invalid("圖片健檢 Excel 快照資訊無效，請重新掃描。");
      }
      try {
        return await this.imageAudit.download({ marketplaceId, exportId });
      } catch (error) {
        return routeError(error, "建立圖片健檢 Excel 時發生未預期的錯誤。");
      }
    }
    const reportId = reportIdentifier(request.query.reportId);
    if (!reportId) return invalid("報表查詢資訊無效，請重新匯出。");
    if (request.query.download !== "1" && !auditRequested && !imageAuditRequested) {
      try {
        const status = await this.listingsExport.status({
          marketplaceId,
          reportId,
        });
        return json({ ...status, message: status.notice });
      } catch (error) {
        return routeError(error, "查詢全商品報表狀態時發生未預期的錯誤。");
      }
    }
    const documentId = reportIdentifier(request.query.documentId);
    if (!documentId) return invalid("報表文件資訊無效，請重新匯出。");
    try {
      const captured = await this.listingsExport.capture({
        marketplaceId,
        reportId,
        documentId,
      });
      const { context, snapshot: data } = captured;
      if (auditRequested || imageAuditRequested) {
        if (auditRequested) {
          return json(await this.contentAudit.captureFromListings({
            context,
            marketplaceId,
            listings: data,
          }));
        }
        return json(await this.imageAudit.captureFromListings({
          context,
          marketplaceId,
          listings: data,
        }));
      }
      return await this.listingsExport.download({
        marketplaceId,
        exportId: captured.exportId,
      });
    } catch (error) {
      return routeError(error, "建立全商品 Excel 時發生未預期的錯誤。");
    }
  }
}
