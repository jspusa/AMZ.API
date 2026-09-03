export type OperationsBoardExpiryItem = Readonly<{
  id: string;
  type: "expiry";
  marketplaceId: string;
  sellerSku: string;
  expiryDate: string;
  note: string;
}>;

export type OperationsBoardPromotionItem = Readonly<{
  id: string;
  type: "promotion";
  date: string;
  title: string;
  note: string;
  countdown: boolean;
}>;

export type OperationsBoardItem =
  | OperationsBoardExpiryItem
  | OperationsBoardPromotionItem;

export type OperationsBoardPublisherDraft =
  | Readonly<{
      type: "expiry";
      marketplaceId: string;
      sellerSku: string;
      expiryDate: string;
      note: string;
    }>
  | Readonly<{
      type: "promotion";
      date: string;
      title: string;
      note: string;
      countdown: boolean;
    }>;

export type OperationsBoardSnapshot = Readonly<{
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  items: readonly OperationsBoardItem[];
}>;

export type OperationsBoardReadResult = Readonly<{
  snapshot: OperationsBoardSnapshot;
  source: "shared" | "last-known-good" | "empty";
  stale: boolean;
  status: "ready" | "not-configured" | "unavailable";
  message?: string;
}>;

export type OperationsBoardFactRequestItem = Readonly<{
  id: string;
  marketplaceId: string;
  sellerSku: string;
}>;

export type OperationsBoardFactField<Value> =
  | Readonly<{ state: "ready"; value: Value }>
  | Readonly<{ state: "unavailable"; value: null }>;

export type OperationsBoardSkuFact = Readonly<{
  id: string;
  marketplaceId: string;
  sellerSku: string;
  mode: "live" | "demo";
  inventory: OperationsBoardFactField<number>;
  price: OperationsBoardFactField<Readonly<{
    amount: number;
    currencyCode: string;
  }>>;
  fetchedAt: string;
}>;

export type OperationsBoardAdminSummary = Readonly<{
  configured: boolean;
  username: string | null;
}>;

export type OperationsBoardEditorState = Readonly<{
  board: OperationsBoardReadResult;
  authenticated: boolean;
  username: string | null;
  expiresAt: string | null;
  pendingDraft: OperationsBoardPublisherDraft | null;
  focusItemId: string | null;
}>;

export type OperationsBoardAdminRotationInput = Readonly<{
  currentUsername: string;
  currentPassword: string;
  newUsername: string;
  newPassword: string;
}>;

export type OperationsBoardEditorBridge = Readonly<{
  state(): Promise<OperationsBoardEditorState>;
  login(input: Readonly<{ username: string; password: string }>): Promise<OperationsBoardEditorState>;
  save(input: Readonly<{
    baseRevision: number;
    items: readonly OperationsBoardItem[];
  }>): Promise<OperationsBoardSnapshot>;
  close(): Promise<void>;
}>;
