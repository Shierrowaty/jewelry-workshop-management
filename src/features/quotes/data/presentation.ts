import type { QuoteSnapshot } from "./types";

export function quoteProductName(snapshot: QuoteSnapshot): string {
  if (snapshot.product.customDesign) return snapshot.product.customName.trim() || "Projekt indywidualny";
  return snapshot.modelName || snapshot.categoryName || "Produkt bez nazwy";
}

export function displayDate(value: string): string {
  if (!value) return "Nie ustalono";
  return value.split("-").reverse().join(".");
}

export function displayTimestamp(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Warsaw" }).format(new Date(value));
}
