import type { OperationsFbaIdentity, OperationsReadMetadata } from "./operations-intelligence";

export type AwdInventoryQuantity = Readonly<{
  quantity: number;
  unitOfMeasurement: "PRODUCT_UNITS" | "CASES" | "PALLETS";
}>;
export type AwdInventoryRow = OperationsFbaIdentity & Readonly<{
  totalOnhandQuantity: number | null;
  totalInboundQuantity: number | null;
  availableDistributableQuantity: number | null;
  reservedDistributableQuantity: number | null;
  replenishmentQuantity: number | null;
  expirationDetails: readonly Readonly<{ expiration: string | null; onhandQuantity: number | null }>[] | null;
}>;
export type AwdShipmentStatus = "CREATED" | "SHIPPED" | "IN_TRANSIT" | "RECEIVING" | "DELIVERED" | "CLOSED" | "CANCELLED" | "UNKNOWN";
export type AwdInboundShipment = Readonly<{
  id: string;
  status: AwdShipmentStatus;
  updatedAt: string | null;
  coverage: "complete" | "partial";
  rows: readonly (OperationsFbaIdentity & Readonly<{
    expectedQuantity: AwdInventoryQuantity | null;
    receivedQuantity: AwdInventoryQuantity | null;
    outstandingQuantity: AwdInventoryQuantity | null;
  }>)[];
}>;
export type AwdInventorySnapshot = OperationsReadMetadata & Readonly<{
  stockScope: "AWD_SHARED_DOWNSTREAM";
  inventoryCoverage: "complete" | "partial";
  shipmentCoverage: "complete" | "partial";
  rows: readonly AwdInventoryRow[];
  shipments: readonly AwdInboundShipment[];
  excludedInventoryRows: number;
}>;
