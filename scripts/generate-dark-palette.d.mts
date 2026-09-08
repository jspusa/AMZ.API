export function darkColor(token: string, role: "fg" | "bg" | "line" | "shadow"): string;
export function createDarkPalette(css: string): string;
export function generateDarkPalette(root?: string): Promise<string>;
