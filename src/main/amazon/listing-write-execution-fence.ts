/** Final main-process context check required immediately before a mutation. */
export type ListingWriteExecutionFence = Readonly<{
  assertCurrent(): Promise<void>;
}>;
