/** Read-only suggestions from one verified FBA audit; never write authority. */
export type UnboundFamilyCandidate = Readonly<{
  parentSku: string;
  parentTitle: string;
  productType: string;
  variationTheme: string;
  matchingChildCount: number;
  familyChildCount: number;
  matchingChildSkus: string[];
  stars: 2 | 3;
  tied: boolean;
  reasons: string[];
}>;

export type UnboundFamilyRecommendation = Readonly<{
  sellerSku: string;
  status: "ranked" | "tied" | "insufficient";
  candidates: UnboundFamilyCandidate[];
  notice: string;
}>;
