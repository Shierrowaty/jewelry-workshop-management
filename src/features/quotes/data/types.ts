import type { QuoteDraft, QuoteTotals } from "../types";

export type QuoteMetadata = Pick<QuoteDraft["customer"], "status" | "dueDate" | "notes">;

// Prices, entered values and display names belong to this quote, not to a live catalog.
export type QuoteSnapshot = Omit<QuoteDraft, "customer"> & {
  customer: Omit<QuoteDraft["customer"], keyof QuoteMetadata>;
  categoryName: string;
  modelName: string;
  totals: QuoteTotals;
};

export type SavedQuote = QuoteMetadata & {
  id: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: "local" | "pending" | "synced" | "conflict";
  schemaVersion: 2;
  calculationVersion: 1;
  revision: number;
  completedAt: string | null;
  snapshot: QuoteSnapshot;
};
