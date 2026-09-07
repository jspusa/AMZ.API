/** Small, consistent line icons for navigation. Labels remain in the caller. */
export default function WorkspaceGlyph({ name }: {
  name: "product" | "pricing" | "operations" | "reports" | "content" | "image" | "aplus" | "variation" | "subscription" | "businessPricing" | "advertising" | "search";
}) {
  const paths = {
    product: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9M8 5.3l8 4.5",
    pricing: "M4 4h8l8 8-8 8-8-8V4Zm4 4h.01M11 11l4 4M15 11l-4 4",
    operations: "M4 19V5M4 19h16M8 15l4-5 4 2 4-7",
    reports: "M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h5",
    content: "M5 5h14M12 5v14M8 19h8M4 9V5M20 9V5",
    image: "M4 4h16v16H4V4Zm0 12 5-5 4 4 3-3 4 4M15 8h.01",
    aplus: "m3 18 5-12 5 12M5 13h6M18 8v8M14 12h8",
    variation: "M12 4v5M6 9h12M6 9v5M18 9v5M9 3h6v3H9V3ZM3 15h6v5H3v-5Zm12 0h6v5h-6v-5Z",
    subscription: "M19 8a8 8 0 0 0-13-2L3 9M3 4v5h5M5 16a8 8 0 0 0 13 2l3-3M16 15h5v5",
    businessPricing: "M4 8h16v12H4V8Zm4 0V4h8v4M4 12h16M10 12v3h4v-3",
    advertising: "m4 10 15-5v14L4 14v-4Zm3 5 2 6h3l-2-5M19 10h3M19 14h3",
    search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 4 6 6",
  };
  return <svg className="workspace-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
