# Amazon A+／「From the brand」唯讀健檢的 SP-API 能力研究

日期：2026-08-23

範圍：所選站點目前 FBA Seller SKU 的 A+ Content 已發布／未發布健檢，以及「From the brand／Brand Story」可辨識性。只查 Amazon 官方 SP-API 文件、官方 OpenAPI model 與官方公告；未使用 Seller Central 私有接口。
限制：本研究未讀取任何真實 Seller SKU、ASIN、Seller ID 或憑證，也沒有呼叫 Amazon 或執行寫入。

## 結論

1. **公開 SP-API 可以安全判定目前授權 selling partner 在指定 marketplace、指定 ASIN 是否有已發布 A+。** Amazon 的正式教學把 `searchContentPublishRecords` 明確列為「Determine which content documents are published to an ASIN」的第一步；查到至少一筆身分完全相符的 `PublishRecord`，即可證明該 ASIN 有已發布 A+。[Create, edit, and publish A+ content](https://developer-docs.amazon.com/sp-api/docs/create-edit-publish-aplus-content) [searchContentPublishRecords reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentpublishrecords)
2. **負向結果必須比正向結果更嚴格。** 只有所有分頁都成功、回應結構完整、沒有 warning、沒有 identity mismatch，最後 `publishRecordList` 仍為空，才可標成「未找到已發布 A+」。任何 400／401／403／404／429／500／503、warning、壞資料、重複或循環 page token、取消或超出安全上限都只能標成「資料未完成」，不能當成沒有 A+。OpenAPI 明載 A+ base response 可同時代表成功或部分成功，而且分頁可能回空頁，必須一路讀到 `nextPageToken` 為空。[Official A+ OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)
3. **這個 operation 沒有批次 ASIN 參數。** 每次 request 必須帶一個 `marketplaceId` 與一個 `asin`，另有選用的 `pageToken`；沒有 `asinSet` 或 batch body。因此全站健檢應先把目前 FBA SKU 依 exact ASIN 去重，再每個唯一 ASIN 呼叫一次並把結果 fan-out 回各 Seller SKU。[searchContentPublishRecords reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentpublishrecords)
4. **不能拿 `searchContentDocuments`＋`listContentDocumentAsinRelations` 冒充目前已發布狀態。** 前者會列出 selling partner 的所有 A+ documents，包含 DRAFT／SUBMITTED／REJECTED／APPROVED；後者只列 document 與 ASIN 的關聯。Amazon 明載「暫停 visible A+ 不會刪除 content document 或 ASIN relations」，所以 APPROVED document 仍有 relation 不等於目前仍發布；判定是否已發布應使用 publish records。[searchContentDocuments reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentdocuments) [Manage A+ content](https://developer-docs.amazon.com/sp-api/docs/manage-aplus-content)
5. **公開、文件化的 A+ API 目前不能可靠辨識「From the brand／Brand Story」。** 現行唯一版本仍是 `2020-11-01`；`PublishRecord` 只公開 marketplace、locale、ASIN、`contentType`、選用且可隨時改變的 opaque `contentSubType`、content reference key。官方列出的全部 module 都是 15 種 `STANDARD_*`，沒有 Brand Story／From the brand 欄位或 enum。不能用 document 名稱、文案、`PREMIUM` badge 或未知 subtype 猜測；前台應顯示「公開 A+ API 未提供可驗證欄位」，不要顯示假的有／無。[A+ Content API guide](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-api-use-case-guide) [A+ Content examples and complete module list](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-examples) [Official A+ OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)
6. **需要 Brand Analytics 或 Product Listing 至少一個角色；AMZ.API 既有 Product Listing 角色理論上已足夠。** 官方 role table 對 `searchContentPublishRecords`、`getContentDocument`、`searchContentDocuments` 等操作都列 NA／EU／FE，且所需角色為 Brand Analytics 或 Product Listing 至少一個。是否實際已授權仍要由 Notebook Key 做唯讀 canary；403 必須標成 capability unavailable，不能讓所有 SKU 變成「沒有 A+」。[A+ Content API roles](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-api-use-case-guide)

## 正式讀取 operation

```http
GET /aplus/2020-11-01/contentPublishRecords
  ?marketplaceId=<exact-current-marketplace>
  &asin=<exact-current-marketplace-asin>
  [&pageToken=<opaque-token>]
```

必要參數與回傳：[searchContentPublishRecords reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentpublishrecords)

| 欄位 | 官方語意 | AMZ.API 驗證 |
| --- | --- | --- |
| request `marketplaceId` | globally unique marketplace identifier | 必須等於目前 UI 所選站點；由 main allowlist 決定，不接受任意前端站點字串 |
| request `asin` | marketplace 內的商品識別碼；operation 每次只接受一個 | 必須來自同一次、已證明 FBA 的 all-listings snapshot；缺失／改寫／衝突不發 request |
| response `publishRecordList[]` | A+ publishing records | 必須為 array；每筆都核對 exact marketplace＋ASIN |
| `contentReferenceKey` | A+ document reference；可能改變、不是 permalink，也不保證等於任何 A+ identifier | 只作本次回應去重／證據，不當永久主鍵，也不顯示成 Seller Central ID |
| `contentType` | `EBC`＝Seller Central A+ Content Manager；`EMC`＝Vendor Central A+ Content Manager | 只接受官方 enum；兩者任一 exact record 都能證明有已發布 A+，但 UI 可另列來源類型 |
| `contentSubType` | 選用的特殊用途 subtype；官方明示可隨時改變 | 原樣視為 opaque；不建立 Brand Story 白名單或猜測邏輯 |
| `locale` | IETF language tag | 驗證 schema；可顯示語系，但不拿語系替代 marketplace identity |
| `nextPageToken` | 下一頁 opaque token | 使用同一 marketplace＋ASIN，直到 token 為空；偵測 token 循環／重複 |
| `warnings[]` | successful or partially successful response 的訊息 | 正向 exact record 可保留「已證明發布」但 coverage 降為 partial；沒有 exact record時不可判 missing |

`PublishRecordList` 在官方 schema 中不是 unique array；同一回應可能有多筆 publishing records，程式不可把「多筆」本身當成錯誤，也不可只取第一筆。對顯示可用 `marketplaceId + asin + contentReferenceKey + contentType + contentSubType + locale` 做本地穩定去重，但任何一筆 exact、well-formed record 已足以證明 A+ 存在。[Official A+ OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)

## 狀態判定

| Audit status | 必要條件 | 前台建議文字 |
| --- | --- | --- |
| `published` | 至少一筆 well-formed record 的 `marketplaceId`＋`asin` 與 request 完全一致 | `已發布 A+` |
| `missing` | exact FBA SKU／ASIN 身分完整；所有 publish-record pages 200、無 warning、schema 完整、token 正常結束；全程沒有 exact record | `未找到已發布 A+` |
| `incomplete` | 缺 ASIN、Listings 身分衝突、任何非 200、warning 且無 positive record、回應畸形、identity mismatch、pagination 未結束、取消或 retry exhausted | `資料未完成，不能判定` |
| `unavailable` | 整個 operation 由角色／authorization／區域能力明確拒絕 | `A+ API 尚未取得讀取權限` |

正向與負向應採不對稱證據：一筆 exact record 就能證明「有」；但要證明「沒有」，必須有完整、warning-free 的空集合。若某頁已有 exact record、後續頁卻失敗，該 ASIN 仍可顯示 `published`，但 `sourceCompleteness` 必須是 `partial`、完整 document count 保持空白。這是基於官方 pagination／partial-success schema 的保守推論。[Official A+ OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)

`404` 不應當成 missing。官方只把它描述為「specified resource does not exist」，沒有承諾「此 ASIN 沒有 A+ 時一定回 404」或其等價性；唯一安全的負向證據是合法 200 response 的完整空集合。[searchContentPublishRecords reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentpublishrecords)

## FBA SKU／ASIN／marketplace identity

A+ API 以 ASIN 而不是 Seller SKU 查詢；FBA-only 範圍必須由 AMZ.API 既有完整 all-listings／Listings evidence 先證明，不能由 A+ API 自己推測履約類型。建議流程：

1. 鎖定 `account scope + live/demo mode + marketplace`；marketplace 必須由 main allowlist 解析至 NA／EU／FE host。
2. 取得同次完整 FBA all-listings snapshot，只納入目前站點、非 parent、Seller SKU 與 ASIN 都安全且唯一的 child／standalone listing。
3. 對 `marketplaceId + asin` 去重；同 ASIN 的多個 FBA Seller SKU 共用一次 A+ read，但每個 Seller SKU 保留自己的 audit row。
4. 任一 Seller SKU 對應多個 ASIN、同 ASIN 跨站混用、ASIN 缺失／不安全、all-listings source partial 時，都不能把 A+ empty 結果套回該列。
5. 回應中的 marketplace 與 ASIN 必須再與 request exact 比對；額外／不相符 record 不得靜默採用。

Amazon 的 operation 明載 `marketplaceId` 與 `asin` 都是 required，且 `PublishRecord` 再次攜帶兩個欄位，因此可以在 main process 做雙向 identity 驗證。[searchContentPublishRecords reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentpublishrecords)

## Pagination、rate limit 與全站掃描時間

官方 A+ paginated response 要求沿用同一組 arguments 呼叫 `nextPageToken`，直到 token 為 null；而且合法頁面可以是空頁，所以遇到空 `publishRecordList` 仍不能提前結束。[Official A+ OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)

目前兩份官方資料有不同預設值：

- operation reference／OpenAPI：`searchContentPublishRecords` 10 requests/second、burst 10；成功回應可能附 `x-amzn-RateLimit-Limit`。[searchContentPublishRecords reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentpublishrecords)
- 專用 rate-limit 頁：per-developer aggregate 30 requests/second，`searchContentPublishRecords` 15 requests/second。[A+ Content API rate limits](https://developer-docs.amazon.com/sp-api/docs/aplus-api-rate-limits)

因此 AMZ.API 不應把 15 寫死。安全起始 token bucket 建議不超過較低的 10 requests/second，並以實際 `x-amzn-RateLimit-Limit` 動態下修；同時預留其他 A+ operations 的 aggregate 額度。429／500／503／transport failure 是唯讀 GET，可遵守 `Retry-After`／jitter 做有限次 retry；retry exhausted 後只標 incomplete，不補 0、不從頭重跑已完成 ASIN。400／403／404 不盲目換參數重試。

A+ API 沒有 batch publish-record endpoint。若 273 個 FBA SKU 去重後仍有 250 個唯一 ASIN，第一頁理論下限約為 25 秒（以保守 10 requests/second 計算），實際還要加 pagination、共用 usage plan、429 backoff 與 network latency。應做 main-process background job、同一 account／mode／marketplace／FBA snapshot single-flight；關閉 drawer 只停止 renderer observer，不取消同一工作。

## 為什麼不能用 documents／relations 取代 publish records

可用的相關唯讀 operations 是：

| Operation | 能回答的問題 | 不能回答的問題 |
| --- | --- | --- |
| `searchContentDocuments` | 此 selling partner 在 marketplace 下有哪些 A+ documents 與 metadata | 不能只憑 document 存在判定某 ASIN 現在已發布 |
| `getContentDocument` | 以 reference key 取得 metadata／contents；metadata status 為 APPROVED／DRAFT／REJECTED／SUBMITTED | APPROVED 不足以排除其已被 suspend |
| `listContentDocumentAsinRelations` | 哪些 ASIN 仍和 document 有 relation | suspend 不會刪 relation，因此 relation 不等於目前 visible/published |
| `searchContentPublishRecords` | 哪些 content documents 已發布到 exact ASIN | **本健檢的正式真相來源** |

Amazon 教學說 `APPROVED` 代表內容核准並發布到 applied ASIN；但管理教學又明載 suspend request 不會刪除 document 或 ASIN relations。若只掃全部 APPROVED documents 與 relations，會把已暫停內容誤判成存在。應直接依 Amazon 指定的 publish-record operation 判定。[Create, edit, and publish A+ content](https://developer-docs.amazon.com/sp-api/docs/create-edit-publish-aplus-content) [Manage A+ content](https://developer-docs.amazon.com/sp-api/docs/manage-aplus-content)

## 「From the brand／Brand Story」能力邊界

現行公開模型提供：

- `contentType`: 只文件化 `EBC`（Seller Central）與 `EMC`（Vendor Central）；
- `contentSubType`: 任意非空 string，官方明示「not every document has one」且「subtypes can change at any time」；
- `ContentBadge`: `BULK`、`GENERATED`、`LAUNCHPAD`、`PREMIUM`、`STANDARD`；
- `ContentModuleType`: 15 個 `STANDARD_*` module。

其中沒有 `BRAND_STORY`、`FROM_THE_BRAND`、brand-story badge、位置欄位或 UI section identifier。官方 examples 頁自稱列出「complete list of available modules」，也沒有 Brand Story module。因此：

1. 不把 `PREMIUM` 當 Brand Story；Premium 是另一個 badge。
2. 不把 `contentSubType` 某個目前觀察到的字串寫成永久 enum；官方已警告 subtype 會改變。
3. 不以 document name、headline、logo module、文案出現 brand 字樣或頁面 HTML 猜測。
4. 不使用 Seller Central cookie／私有 XHR／爬商品頁補資料。
5. 第一版固定回 `fromTheBrandStatus: "not_verifiable_by_public_api"`，前台說明 `Amazon 公開 A+ API 未提供可驗證欄位`。

這個限制不妨礙 A+ 已發布健檢；只是不能把同一個 publish record 再可靠拆成「一般 A+」與「From the brand」。若 Amazon 日後在官方 model／changelog 新增明確 enum 或 operation，才新增識別。[A+ Content API guide](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-api-use-case-guide) [A+ Content examples](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-examples) [Official A+ OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)

## 最小安全 audit DTO

```ts
type AplusAuditStatus = "published" | "missing" | "incomplete" | "unavailable";

type AplusAuditRow = {
  sellerSku: string;
  asin: string | null;
  marketplaceId: string;
  status: AplusAuditStatus;
  sourceCompleteness: "complete" | "partial";
  publishedRecordCount: number | null; // incomplete／partial 時不要填假的完整數
  contentTypes: Array<"EBC" | "EMC">;
  locales: string[];
  fromTheBrandStatus: "not_verifiable_by_public_api";
  reasonCode:
    | "PUBLISHED_RECORD_FOUND"
    | "NO_PUBLISHED_RECORD"
    | "FBA_IDENTITY_INCOMPLETE"
    | "A_PLUS_ACCESS_UNAVAILABLE"
    | "A_PLUS_READ_FAILED"
    | "A_PLUS_RESPONSE_INVALID"
    | "A_PLUS_PAGINATION_INCOMPLETE";
};

type AplusAuditSnapshot = {
  marketplaceId: string;
  fetchedAt: string;
  fbaSnapshotId: string;
  totals: {
    eligibleFbaSkus: number;
    uniqueAsins: number;
    published: number;
    missing: number;
    incomplete: number;
  };
  rows: AplusAuditRow[];
  notice: string;
};
```

DTO 不需要把 `contentReferenceKey` 長期送到 renderer；它不是 Secret，但 Amazon 明載可能改變且不是 permalink。main 可在單次工作內用它去重，renderer 只需要存在狀態、完整度、content type／locale 與固定原因碼。任何 upstream raw message、request URL、page token、account scope 或憑證都不應回 renderer。[Official A+ OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)

## AMZ.API 最小安全 flow

1. 使用現有 FBA-only all-listings 完整快照，建立 exact Seller SKU／ASIN／marketplace seed；parent 與身分不完整列不進 A+ request。
2. 依 exact `marketplaceId + asin` 去重，建立 main-owned background job；同一 active snapshot single-flight。
3. 對每個唯一 ASIN 呼叫 `searchContentPublishRecords`，遵守較低 10 rps 起始限制與實際 rate-limit header。
4. 每頁驗證 JSON envelope、`publishRecordList`、warnings、exact identity、content type、locale、reference key 與 token 前進；空頁但有 token 要繼續。
5. 依前述不對稱證據分類：有 exact record＝published；完整空集合＝missing；其餘＝incomplete／unavailable。
6. 將 ASIN 結果 fan-out 到原 FBA Seller SKU；同一 ASIN 的多 SKU 不重複打 Amazon。
7. UI 摘要顯示 `已發布 A+`、`未找到已發布 A+`、`資料未完成` 三個數字；unavailable 以整體 capability notice 呈現，不把 273 個權限錯誤冒充 273 個缺 A+。
8. 「From the brand」固定顯示公開 API 能力限制，不計入缺值數，也不製造 yes／no。
9. 這個功能只接 GET；不要把 create／update／relation POST／approval／suspend operations 加入 renderer route。

正式上線前仍需用 Jasper 的 Notebook Key 做一個 **唯讀** US canary：一個 Seller Central 已知有 A+ 的 FBA ASIN、一個已知沒有 A+ 的 FBA ASIN，以及至少一個同 ASIN 對應多 Seller SKU 的案例；核對 200 empty-list 語義、實際 pagination、403 role 行為、rate-limit header 與 Seller Central 顯示。CI／static sandbox 能驗證 schema 與 parser，不能替代真實 selling-partner scope 的結果。這個 canary 不需要 Touch ID，也不包含任何 Amazon mutation。

## 官方來源索引

- [A+ Content API guide／versions／roles](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-api-use-case-guide)
- [Create, edit, and publish A+ content](https://developer-docs.amazon.com/sp-api/docs/create-edit-publish-aplus-content)
- [Manage A+ content](https://developer-docs.amazon.com/sp-api/docs/manage-aplus-content)
- [searchContentPublishRecords reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentpublishrecords)
- [searchContentDocuments reference](https://developer-docs.amazon.com/sp-api/reference/searchcontentdocuments)
- [getContentDocument reference](https://developer-docs.amazon.com/sp-api/reference/getcontentdocument)
- [listContentDocumentAsinRelations reference](https://developer-docs.amazon.com/sp-api/reference/listcontentdocumentasinrelations)
- [A+ Content examples／complete module list](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-examples)
- [A+ Content API rate limits](https://developer-docs.amazon.com/sp-api/docs/aplus-api-rate-limits)
- [Official A+ Content OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/aplus-content-api-model/aplusContent_2020-11-01.json)
- [Official 2021 A+ Content API launch announcement](https://github.com/amzn/selling-partner-api-models/discussions/3057)
