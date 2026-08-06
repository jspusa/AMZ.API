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

export type SpellcheckWordResult = {
  word: string;
  suggestions: string[];
};

export type ExternalDestination =
  | "seller-central"
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
    save(input: CredentialInput): Promise<CredentialSummary>;
    clear(): Promise<CredentialSummary>;
    test(): Promise<ConnectionTestResult>;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
    openExternal(destination: ExternalDestination): Promise<void>;
  };
  spellcheck: {
    check(words: string[]): SpellcheckWordResult[];
  };
  updates: {
    check(): Promise<UpdateStatus>;
    install(): Promise<void>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
};
