import type { ApiRequest, ApiResponse } from "../shared/contracts";

export type BusinessPricingMutationCommand = Readonly<{
  operation: "read";
  request: ApiRequest;
}>;

export interface BusinessPricingMutationsPort {
  handle(command: BusinessPricingMutationCommand): Promise<ApiResponse>;
}
