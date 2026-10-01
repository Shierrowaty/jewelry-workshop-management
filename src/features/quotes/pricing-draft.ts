import type { QuoteDraft, QuoteTotals } from "./types";

export function priceInput(cents: number | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** Explicit event-driven changes: one authoritative input, no reciprocal effects. */
export function changePricing(draft: QuoteDraft, basis: "gross" | "cleanProfit", value: string): QuoteDraft {
  return {
    ...draft,
    agreedGross: basis === "gross" ? value : draft.agreedGross,
    pricing: { model: "net-costs-v1", basis, desiredCleanProfit: basis === "cleanProfit" ? value : draft.pricing?.desiredCleanProfit ?? "" },
  };
}

/** Only called after the user accepts conversion; never on loading historical data. */
export function convertToNetCostPricing(draft: QuoteDraft, totals: QuoteTotals): QuoteDraft {
  const next = structuredClone(draft);
  next.pricing = { model: "net-costs-v1", basis: "gross", desiredCleanProfit: "" };
  next.vatRate = "23";
  next.agreedGross = priceInput(totals.gross);
  next.product = { ...next.product, weight: next.gold.mass, goldColor: next.gold.color };
  next.gold.settlementVersion = "fine-au-v1";
  next.gold.customerLots = next.gold.source === "ours" ? [] : [{ id: "historical-gold", fineness: next.gold.fineness, mass: next.gold.source === "customer" ? next.gold.mass : next.gold.customerMass }];
  next.gold.estimatedMass = next.gold.mass;
  next.gold.ourMass = (totals.gold.ourMassMilligrams / 1000).toFixed(3);
  next.stones = next.stones.map(stone => ({ ...stone, priceBasis: "piece" }));
  return next;
}
