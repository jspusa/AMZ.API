import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createBusinessPricingCapabilities,
} from "../src/main/amazon/business-pricing-capabilities";
import type {
  ListingsReadAdapter,
  ProductTypeDefinitionReadResult,
} from "../src/main/amazon/listings-reads";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const PRODUCT_TYPE = "PET_FOOD";
const SELLER_ID = "TEST_B2B_SELLER";

function recordAt(value: unknown, ...path: string[]): Record<string, unknown> {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`Expected object at ${path.join(".")}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error(`Expected object at ${path.join(".")}`);
  }
  return current as Record<string, unknown>;
}

function businessSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      purchasable_offer: {
        type: "array",
        items: {
          type: "object",
          properties: {
            audience: { type: "string", enum: ["ALL", "B2B"] },
            currency: { type: "string", enum: ["USD"] },
            marketplace_id: {
              type: "string",
              enum: [MARKETPLACE_ID],
            },
            our_price: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  schedule: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        value_with_tax: { type: "number", editable: true },
                      },
                    },
                  },
                },
              },
            },
            quantity_discount_plan: {
              type: "array",
              editable: true,
              minItems: 0,
              maxItems: 1,
              items: {
                type: "object",
                properties: {
                  schedule: {
                    type: "array",
                    minItems: 1,
                    maxItems: 1,
                    items: {
                      type: "object",
                      properties: {
                        discount_type: {
                          type: "string",
                          enum: ["fixed", "percent"],
                          editable: true,
                        },
                        levels: {
                          type: "array",
                          editable: true,
                          minItems: 1,
                          maxItems: 5,
                          items: {
                            type: "object",
                            properties: {
                              lower_bound: {
                                type: "integer",
                                minimum: 1,
                                editable: true,
                              },
                              value: {
                                type: "number",
                                exclusiveMinimum: 0,
                                maximum: 100,
                                editable: true,
                              },
                            },
                            required: ["lower_bound", "value"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["discount_type", "levels"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["schedule"],
                additionalProperties: false,
              },
            },
          },
        },
      },
    },
  };
}

function sellerPtdWithLiveOfferConstraints(): Record<string, unknown> {
  const schema = businessSchema();
  schema.allOf = [{
    properties: {
      purchasable_offer: {
        items: {
          if: {
            required: ["audience"],
            properties: {
              audience: { enum: ["B2B"] },
            },
          },
          then: {
            required: ["our_price"],
            properties: {
              our_price: { minItems: 1 },
            },
          },
        },
      },
    },
  }, {
    if: {
      properties: {
        purchasable_offer: {
          contains: {
            required: ["quantity_discount_plan"],
            properties: {
              quantity_discount_plan: {
                contains: {
                  required: ["schedule"],
                  properties: {
                    schedule: {
                      contains: {
                        required: ["discount_type"],
                        properties: {
                          discount_type: { enum: ["percent"] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    then: {
      properties: {
        purchasable_offer: {
          items: {
            properties: {
              quantity_discount_plan: {
                items: {
                  properties: {
                    schedule: {
                      items: {
                        properties: {
                          levels: {
                            items: {
                              properties: {
                                value: { maximum: 99 },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, {
    properties: {
      purchasable_offer: {
        items: {
          if: {
            required: ["audience"],
            properties: {
              audience: { enum: ["B2B"] },
            },
          },
          then: {
            properties: {
              quantity_discount_plan: { maxItems: 1 },
            },
          },
          else: {
            not: { required: ["quantity_discount_plan"] },
          },
        },
      },
    },
  }];
  return schema;
}

function definitionResult(
  schema: Record<string, unknown>,
  options: Readonly<{
    checksum?: string;
    sellerSpecific?: boolean;
  }> = {},
): ProductTypeDefinitionReadResult {
  const schemaBytes = new TextEncoder().encode(JSON.stringify(schema));
  const checksum = options.checksum ?? createHash("md5")
    .update(schemaBytes)
    .digest("base64");
  return {
    identity: {
      operation: "definition",
      intent: "business-offer",
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    },
    status: 200,
    envelope: {
      productType: PRODUCT_TYPE,
      marketplaceIds: [MARKETPLACE_ID],
      schema: {
        link: { resource: "https://example.invalid/seller-schema.json" },
        checksum,
      },
    },
    requestId: "REQ-B2B-PTD-1",
    rateLimit: null,
    retryAfter: null,
    schemaEnvelope: schema,
    schemaBytes,
    sellerSpecific: options.sellerSpecific ?? true,
  } as ProductTypeDefinitionReadResult;
}

function fixture(options: Readonly<{
  readDefinition?: ListingsReadAdapter["readDefinition"];
  now?: () => number;
}> = {}) {
  let generation = 7;
  let sellerId: string | null = SELLER_ID;
  let readCount = 0;
  const schema = businessSchema();
  const defaultReadDefinition: ListingsReadAdapter["readDefinition"] =
    async () => {
      readCount += 1;
      return definitionResult(schema);
    };
  const owner = createBusinessPricingCapabilities({
    listingsReads: {
      readDefinition: options.readDefinition ?? defaultReadDefinition,
    },
    credentialGeneration: () => generation,
    sellerId: () => sellerId,
    marketplace: () => ({
      label: "美國",
      region: "na",
      currencyCode: "USD",
    }),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    owner,
    schema,
    get readCount() {
      return readCount;
    },
    setGeneration(value: number) {
      generation = value;
    },
    setSellerId(value: string | null) {
      sellerId = value;
    },
  };
}

describe("Business Pricing capability owner", () => {
  it("keeps an exact seller-scoped PTD for 15 minutes and honors force refresh", async () => {
    let now = 10_000;
    const subject = fixture({ now: () => now });

    const first = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });
    const cached = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });
    expect(cached).toBe(first);
    expect(subject.readCount).toBe(1);

    await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
      forceRefresh: true,
    });
    expect(subject.readCount).toBe(2);

    now += 15 * 60_000;
    await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });
    expect(subject.readCount).toBe(3);
  });

  it("allows Amazon Validation Preview when a seller PTD accepts B2B fields without positive editable annotations", async () => {
    const schema = JSON.parse(JSON.stringify(
      businessSchema(),
      (key, value) => key === "editable" ? undefined : value,
    )) as Record<string, unknown>;
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });

    expect(capability).toMatchObject({
      supported: true,
      editable: true,
      reason: null,
      quantityDiscountsSupported: true,
      quantityDiscountsEditable: true,
      quantityDiscountsReason: null,
    });
    expect(subject.owner.quantityDiscountPlanSupported({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
      schemaChecksum: capability.schemaChecksum!,
      levels: [{ lowerBound: 5, value: 5 }],
    })).toBe(true);
  });

  it("composes the live seller PTD offer constraints before allowing B2B preview", async () => {
    const schema = sellerPtdWithLiveOfferConstraints();
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });

    expect(capability).toMatchObject({
      supported: true,
      editable: true,
      reason: null,
      quantityDiscountsSupported: true,
      quantityDiscountsEditable: true,
      quantityDiscountsReason: null,
    });
    expect(subject.owner.quantityDiscountPlanSupported({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
      schemaChecksum: capability.schemaChecksum!,
      levels: [{ lowerBound: 5, value: 100 }],
    })).toBe(false);
  });

  it("fails an unknown relevant root constraint closed", async () => {
    const schema = sellerPtdWithLiveOfferConstraints();
    (schema.allOf as unknown[]).push({
      properties: {
        purchasable_offer: {
          items: {
            dependentSchemas: {
              audience: { required: ["our_price"] },
            },
          },
        },
      },
    });
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    await expect(subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    })).resolves.toMatchObject({
      supported: true,
      editable: false,
      quantityDiscountsEditable: false,
    });
  });

  it("applies a root additionalProperties restriction without a properties map", async () => {
    const schema = sellerPtdWithLiveOfferConstraints();
    (schema.allOf as unknown[]).push({
      properties: {
        purchasable_offer: {
          items: { additionalProperties: false },
        },
      },
    });
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    await expect(subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    })).resolves.toMatchObject({
      supported: true,
      editable: false,
      quantityDiscountsEditable: false,
    });
  });

  it("keeps an explicit seller PTD Business Price prohibition read-only", async () => {
    const schema = businessSchema();
    recordAt(
      schema,
      "properties",
      "purchasable_offer",
      "items",
      "properties",
      "our_price",
      "items",
      "properties",
      "schedule",
      "items",
      "properties",
      "value_with_tax",
    ).editable = false;
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });

    expect(capability).toMatchObject({
      supported: true,
      editable: false,
      quantityDiscountsEditable: false,
    });
  });

  it("keeps an explicit seller PTD quantity-discount prohibition read-only", async () => {
    const schema = businessSchema();
    recordAt(
      schema,
      "properties",
      "purchasable_offer",
      "items",
      "properties",
      "quantity_discount_plan",
    ).readOnly = true;
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });

    expect(capability).toMatchObject({
      supported: true,
      editable: true,
      quantityDiscountsSupported: true,
      quantityDiscountsEditable: false,
    });
  });

  it("fails a malformed seller PTD Business Price editability annotation closed", async () => {
    const schema = businessSchema();
    recordAt(
      schema,
      "properties",
      "purchasable_offer",
      "items",
      "properties",
      "our_price",
      "items",
      "properties",
      "schedule",
      "items",
      "properties",
      "value_with_tax",
    ).editable = "false";
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });

    expect(capability).toMatchObject({
      supported: true,
      editable: false,
      quantityDiscountsEditable: false,
    });
  });

  it("fails a malformed seller PTD quantity-discount readOnly annotation closed", async () => {
    const schema = businessSchema();
    recordAt(
      schema,
      "properties",
      "purchasable_offer",
      "items",
      "properties",
      "quantity_discount_plan",
    ).readOnly = "true";
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });

    expect(capability).toMatchObject({
      supported: true,
      editable: true,
      quantityDiscountsSupported: true,
      quantityDiscountsEditable: false,
    });
  });

  it("fails a malformed seller PTD root editability annotation closed", async () => {
    const schema = businessSchema();
    schema.editable = null;
    const subject = fixture({
      readDefinition: async () => definitionResult(schema),
    });

    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });

    expect(capability).toMatchObject({
      supported: true,
      editable: false,
      quantityDiscountsEditable: false,
    });
  });

  it("re-evaluates a proposed QDP only against the exact current cached schema", async () => {
    const subject = fixture();
    const capability = await subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    });
    const proposal = {
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
      schemaChecksum: capability.schemaChecksum!,
      levels: [{ lowerBound: 5, value: 5 }],
    } as const;

    expect(subject.owner.quantityDiscountPlanSupported(proposal)).toBe(true);
    expect(subject.owner.quantityDiscountPlanSupported({
      ...proposal,
      schemaChecksum: "different-schema",
    })).toBe(false);

    subject.setGeneration(8);
    expect(subject.owner.quantityDiscountPlanSupported(proposal)).toBe(false);
    subject.setGeneration(7);
    subject.setSellerId("ANOTHER_SELLER");
    expect(subject.owner.quantityDiscountPlanSupported(proposal)).toBe(false);
    subject.setSellerId(SELLER_ID);
    subject.owner.clear();
    expect(subject.owner.quantityDiscountPlanSupported(proposal)).toBe(false);
  });

  it("rejects stale PTD results when credentials or Seller ID change in flight", async () => {
    let generation = 1;
    let sellerId = SELLER_ID;
    const schema = businessSchema();
    const owner = createBusinessPricingCapabilities({
      listingsReads: {
        async readDefinition() {
          generation += 1;
          sellerId = "REPLACED_SELLER";
          return definitionResult(schema);
        },
      },
      credentialGeneration: () => generation,
      sellerId: () => sellerId,
      marketplace: () => ({
        label: "美國",
        region: "na",
        currencyCode: "USD",
      }),
    });

    await expect(owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    })).rejects.toMatchObject({
      code: "CREDENTIALS_CHANGED",
      status: 409,
      message: "Amazon 憑證或 Seller ID 已在 B2B PTD 查詢期間改變；舊結果已丟棄。",
    });
  });

  it("rejects schema checksum drift and never falls back to generic PRODUCT", async () => {
    const schema = businessSchema();
    let calls = 0;
    const owner = createBusinessPricingCapabilities({
      listingsReads: {
        async readDefinition(plan) {
          calls += 1;
          expect(plan).toEqual({
            intent: "business-offer",
            marketplaceId: MARKETPLACE_ID,
            productType: PRODUCT_TYPE,
          });
          return definitionResult(schema, { checksum: "wrong-checksum" });
        },
      },
      credentialGeneration: () => 1,
      sellerId: () => SELLER_ID,
      marketplace: () => ({
        label: "美國",
        region: "na",
        currencyCode: "USD",
      }),
    });

    await expect(owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    })).rejects.toMatchObject({
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      status: 502,
      message:
        "Amazon B2B seller-specific PTD schema 與官方 checksum 不一致，已停止使用。",
    });
    expect(calls).toBe(1);

    await expect(owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: "PRODUCT",
    })).rejects.toMatchObject({
      code: "LISTING_IDENTITY_MISMATCH",
      status: 409,
    });
    expect(calls).toBe(1);
  });

  it("rejects a generic adapter result for the write-related B2B intent", async () => {
    const schema = businessSchema();
    const genericResult = definitionResult(schema, { sellerSpecific: false });
    const subject = fixture({
      readDefinition: async () => genericResult,
    });

    await expect(subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof SpApiError &&
      error.code === "UPSTREAM_UNAVAILABLE" &&
      error.message.includes("generic schema")
    );
  });

  it("preserves the exact missing Seller ID failure", async () => {
    const subject = fixture();
    subject.setSellerId(null);

    await expect(subject.owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: PRODUCT_TYPE,
    })).rejects.toMatchObject({
      code: "LISTINGS_NOT_CONFIGURED",
      status: 503,
      message:
        "美國站尚未設定 Seller ID，無法取得 seller-specific B2B PTD。",
    });
    expect(subject.readCount).toBe(0);
  });
});
