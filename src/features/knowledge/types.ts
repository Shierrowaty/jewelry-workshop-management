export type KnowledgeCategory = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt?: string; revision?: number };
export type KnowledgeKind = "stone" | "product";
export type KnowledgeDraft = {
  kind: KnowledgeKind;
  categoryId: string;
  subcategoryId: string;
  name: string;
  notes: string;
  entryDate: string;
  supplier: string;
  shape: string;
  dimensions: string;
  carats: string;
  priceBasis: "carat" | "piece";
  unitNetPrice: string;
  referenceWeight: string;
  fineness: string;
  goldColor: string;
  goldPricePerGram: string;
  materialCost: string;
  laborPrice: string;
  finishedPrice: string;
};
export type KnowledgeEntry = KnowledgeDraft & { id: string; revision: number; createdAt: string; updatedAt: string; archivedAt: string | null };
export type KnowledgeFilters = { search: string; categoryId: string; subcategoryId: string; kind: "" | KnowledgeKind; status: "active" | "archived" | "all" };

export function emptyKnowledgeDraft(entryDate: string, kind: KnowledgeKind = "stone"): KnowledgeDraft {
  return { kind, categoryId: "", subcategoryId: "", name: "", notes: "", entryDate, supplier: "", shape: "", dimensions: "", carats: "", priceBasis: "carat", unitNetPrice: "", referenceWeight: "", fineness: "", goldColor: "", goldPricePerGram: "", materialCost: "", laborPrice: "", finishedPrice: "" };
}
