import type { QuoteDraft } from "./types";

export function getQuoteDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function createEmptyQuote(quoteDate: string): QuoteDraft {
  return {
    pricing: { model: "net-costs-v1", basis: "cleanProfit", desiredCleanProfit: "" },
    customer: { nickname: "", name: "", channel: "", contact: "", quoteDate, dueDate: "", status: "Wycena", notes: "" },
    product: { size: "", goldColor: "Żółte", weight: "", twoColors: false, colorOne: "", colorTwo: "", categoryId: "", modelId: "", customDesign: false, customName: "", variant: "" },
    gold: { settlementVersion: "fine-au-v1", customerLots: [], estimatedMass: "", ourMass: "", source: "ours", fineness: "585", color: "Żółte", mass: "", customerMass: "", purchasePerGram: "", markupPerGram: "" },
    stones: [],
    labor: [],
    otherCosts: [],
    vatRate: "23",
    agreedGross: "",
  };
}
