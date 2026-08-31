export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiBody =
  | { kind: "json"; value: Record<string, unknown> }
  | {
      kind: "multipart";
      fields: Record<string, string>;
      file: {
        name: string;
        type: string;
        bytes: Uint8Array;
      };
    };

export type ApiRequest = {
  requestId: string;
  method: ApiMethod;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: ApiBody;
};

export type ApiResponseBody =
  | { kind: "json"; value: unknown }
  | { kind: "bytes"; value: Uint8Array };

export type ApiResponse = {
  status: number;
  headers: Record<string, string>;
  body: ApiResponseBody;
};

export type SpApiRegion = "na" | "fe" | "eu";

export type AdvertisingApiRegion = SpApiRegion;

export type AdvertisingCredentialInput = {
  lwaClientId?: string;
  lwaClientSecret?: string;
  refreshToken?: string;
  oauthRegion?: AdvertisingApiRegion;
};

export type AdvertisingCredentialSummary = {
  encryptionAvailable: boolean;
  hasVault: boolean;
  configured: boolean;
  lwaConfigured: boolean;
  refreshTokenConfigured: boolean;
  oauthRegion: AdvertisingApiRegion;
  updatedAt: string | null;
};

export type AdvertisingConnectionTestResult = {
  ok: boolean;
  testedAt: string;
  marketplaceId: string;
  marketplaceCode: string;
  accountType: "seller" | null;
  message: string;
  requestId: string | null;
};

export type RegionCredentialInput = {
  refreshToken?: string;
  sellerId?: string;
};

export type ImageStorageCredentialInput = {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  publicBaseUrl?: string;
};

export type CredentialInput = {
  lwaClientId?: string;
  lwaClientSecret?: string;
  regions?: Partial<Record<SpApiRegion, RegionCredentialInput>>;
  imageStorage?: ImageStorageCredentialInput;
  replenishmentSkillUrl?: string;
};

export type CredentialSummary = {
  encryptionAvailable: boolean;
  hasVault: boolean;
  lwaConfigured: boolean;
  regions: Record<
    SpApiRegion,
    {
      configured: boolean;
      refreshTokenHint: string | null;
      sellerIdHint: string | null;
    }
  >;
  imageStorageConfigured: boolean;
  imagePublicBaseUrl: string | null;
  replenishmentSkillConfigured: boolean;
  updatedAt: string | null;
};

export type ConnectionTestResult = {
  ok: boolean;
  testedAt: string;
  marketplaceId: string | null;
  regions: Partial<
    Record<SpApiRegion, { ok: boolean; message: string; requestId: string | null }>
  >;
};

export type UpdateStatus = {
  state:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version?: string;
  percent?: number;
  message?: string;
};

export type ExternalDestination =
  | "seller-central"
  | "a-plus-content"
  | "coupons"
  | "subscribe-save"
  | "advertising"
  | "github";

export type DesktopBridge = {
  api: {
    request(input: ApiRequest): Promise<ApiResponse>;
    cancel(requestId: string): void;
  };
  credentials: {
    status(): Promise<CredentialSummary>;
    openEditor(): Promise<void>;
    clear(): Promise<CredentialSummary>;
    test(marketplaceId?: string): Promise<ConnectionTestResult>;
  };
  advertisingCredentials: {
    status(): Promise<AdvertisingCredentialSummary>;
    openEditor(): Promise<void>;
    clear(): Promise<AdvertisingCredentialSummary>;
    test(marketplaceId: string): Promise<AdvertisingConnectionTestResult>;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
    openExternal(destination: ExternalDestination): Promise<void>;
    openSellerCentralInventory?(sellerSku: string): Promise<void>;
  };
  updates: {
    current?(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    install(): Promise<void>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
};

export type CredentialEditorBridge = Readonly<{
  save(input: CredentialInput): Promise<CredentialSummary>;
  close(): Promise<void>;
}>;

export type AdvertisingCredentialEditorBridge = Readonly<{
  save(input: AdvertisingCredentialInput): Promise<AdvertisingCredentialSummary>;
  close(): Promise<void>;
}>;
