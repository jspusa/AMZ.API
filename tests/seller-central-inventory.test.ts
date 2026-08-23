import { describe, expect, it } from "vitest";
import { sellerCentralInventoryUrl } from "../src/main/seller-central-inventory";

describe("Seller Central inventory handoff", () => {
  it("builds the exact fixed inventory destination with a URL-encoded Seller SKU", () => {
    expect(sellerCentralInventoryUrl("FBA SKU/&?=1")).toBe(
      "https://sellercentral.amazon.com/myinventory/inventory?fulfilledBy=all&page=1&pageSize=250&searchField=all&searchTerm=FBA%20SKU%2F%26%3F%3D1&sort=date_created_desc&status=all&ref_=xx_invmgr_favb_xx",
    );
  });

  it("cannot be turned into an arbitrary URL or extra query parameter", () => {
    const smuggledSku = "x&status=evil#https://evil.test";
    const destination = new URL(sellerCentralInventoryUrl(smuggledSku));

    expect(destination.origin).toBe("https://sellercentral.amazon.com");
    expect(destination.pathname).toBe("/myinventory/inventory");
    expect(destination.searchParams.get("searchTerm")).toBe(smuggledSku);
    expect(destination.searchParams.getAll("status")).toEqual(["all"]);
    expect([...destination.searchParams.keys()]).toEqual([
      "fulfilledBy",
      "page",
      "pageSize",
      "searchField",
      "searchTerm",
      "sort",
      "status",
      "ref_",
    ]);
  });

  it.each([
    "",
    " FBA-SKU",
    "FBA-SKU ",
    "FBA\u0000SKU",
    "FBA\u200bSKU",
    "A".repeat(41),
  ])("rejects an unsafe or non-exact Seller SKU: %j", (sellerSku) => {
    expect(() => sellerCentralInventoryUrl(sellerSku)).toThrow(/Seller SKU/u);
  });

  it("rejects non-string bridge input at runtime", () => {
    expect(() => sellerCentralInventoryUrl({ url: "https://evil.test" })).toThrow(
      /Seller SKU/u,
    );
  });
});
