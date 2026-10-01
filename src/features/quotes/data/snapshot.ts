import { calculateQuote } from "../calculations";
import type { ProductCatalog, QuoteDraft } from "../types";
import type { QuoteSnapshot, SavedQuote } from "./types";

export function draftFromQuote(quote: SavedQuote): QuoteDraft {
  const { snapshot, status, dueDate, notes } = quote;
  return structuredClone({
    ...(snapshot.pricing ? { pricing: snapshot.pricing } : {}),
    customer: { ...snapshot.customer, status, dueDate, notes },
    product: snapshot.product,
    gold: snapshot.gold,
    stones: snapshot.stones,
    labor: snapshot.labor,
    otherCosts: snapshot.otherCosts,
    vatRate: snapshot.vatRate,
    agreedGross: snapshot.agreedGross,
  });
}

// Keep selected historical options visible even when today's catalog renames/removes them.
export function catalogForQuote(catalog: ProductCatalog, snapshot: QuoteSnapshot): ProductCatalog {
  const result = structuredClone(catalog);
  const { categoryId, modelId } = snapshot.product;
  if (categoryId) {
    result.categories = result.categories.filter((item) => item.id !== categoryId);
    result.categories.unshift({ id: categoryId, name: snapshot.categoryName || categoryId });
  }
  if (modelId) {
    result.models = result.models.filter((item) => item.id !== modelId);
    result.models.unshift({ id: modelId, categoryId, name: snapshot.modelName || modelId });
  }
  return result;
}

export function snapshotFromDraft(draft: QuoteDraft, catalog: ProductCatalog, previous?: QuoteSnapshot) {
  const input = structuredClone(draft);
  const { totals } = calculateQuote(input);
  if (!totals) return null;
  if (input.pricing) {
    // Keep the legacy transport fields coherent; UI edits weight/color only in Product.
    input.gold.mass = input.product.weight ?? input.gold.mass;
    input.gold.color = input.product.goldColor ?? input.gold.color;
    input.vatRate = "23";
  }
  const { customer, ...pricing } = input;
  const { status, dueDate, notes, ...customerSnapshot } = customer;
  const sameCategory = previous && previous.product.categoryId === input.product.categoryId;
  const sameModel = sameCategory && previous.product.modelId === input.product.modelId;
  const snapshot: QuoteSnapshot = {
    ...pricing,
    customer: customerSnapshot,
    categoryName: sameCategory ? previous.categoryName : catalog.categories.find((item) => item.id === input.product.categoryId)?.name ?? "",
    modelName: sameModel ? previous.modelName : catalog.models.find((item) => item.id === input.product.modelId)?.name ?? "",
    totals,
  };
  return { status, dueDate, notes, snapshot };
}
