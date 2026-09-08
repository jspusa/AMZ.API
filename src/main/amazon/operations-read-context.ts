import type { OperationsFbaIdentity } from "../../shared/operations-intelligence";
import type { SpExecutionContext } from "./sp-execution-context";

/** Created by the main-owned coordinator after exact current-FBA proof. */
export type OperationsReadInput = Readonly<{
  context: SpExecutionContext;
  fba: readonly OperationsFbaIdentity[];
  signal: AbortSignal;
}>;
