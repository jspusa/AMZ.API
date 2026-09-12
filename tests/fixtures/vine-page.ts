// Synthetic page structure only; no copied seller/product batch is retained.
const columns = "產品名稱\nASIN\n狀態\n註冊日期\n產品網站上線日期\n可用\n已註冊\n已申報\nAmazon Vine 評論";
export function vinePageRow({ asin = "B000000001", title = "Sample product, small | 2 pack", status = "正在等待評論", date = "6/16/2026", available = "2,316", enrolled = "30", claimed = "29", reviews = "22" } = {}): string {
  return ` 產品圖片\t\n${title}\n${asin}\n${status}\n${date}\n12/31/2026\n${available}\n${enrolled}\n${claimed}\n${reviews}\n\n詳情\n\n停止\n`;
}
export function vinePage(...rows: string[]): string {
  return `Seller Central\nVine\n註冊 1-${rows.length} 之於 136\n${columns}\n${rows.join("\n")}\n頁面\n之於 6\n前往\n回饋\n`;
}

