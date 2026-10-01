import { parseDecimal } from "../quotes/calculations";
import type { KnowledgeDraft } from "./types";

export function calculateKnowledge(draft: KnowledgeDraft) {
  const errors: Record<string, string> = {};
  const read = (key: keyof KnowledgeDraft, precision = 2) => {
    const result = parseDecimal(draft[key], precision);
    if (result === null) errors[key] = `Wpisz nieujemną liczbę, do ${precision} miejsc po przecinku.`;
    return result ?? BigInt(0);
  };
  if (!draft.name.trim()) errors.name = "Podaj nazwę.";
  if (!draft.categoryId) errors.categoryId = "Wybierz kategorię.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.entryDate) || !Number.isFinite(Date.parse(draft.entryDate)) || new Date(draft.entryDate).toISOString().slice(0, 10) !== draft.entryDate) errors.entryDate = "Podaj poprawną datę wpisu.";
  if (!["stone", "product"].includes(draft.kind)) errors.kind = "Wybierz typ rekordu.";
  let stoneNet: bigint | null = null;
  if (draft.kind === "stone") {
    const carats = read("carats", 3);
    const price = read("unitNetPrice");
    if (!["carat", "piece"].includes(draft.priceBasis)) errors.priceBasis = "Wybierz sposób ceny.";
    stoneNet = draft.priceBasis === "carat" ? (carats * price + BigInt(500)) / BigInt(1000) : price;
    if (stoneNet > BigInt("1000000000000")) errors.unitNetPrice = "Kwota przekracza zakres kalkulatora.";
  } else {
    read("referenceWeight", 3);
    for (const key of ["goldPricePerGram", "materialCost", "laborPrice", "finishedPrice"] as const) read(key);
    if (draft.fineness.trim()) { const value = read("fineness", 0); if (value < BigInt(1) || value > BigInt(1000)) errors.fineness = "Podaj próbę od 1 do 1000."; }
  }
  const vat = stoneNet === null ? null : (stoneNet * BigInt(23) + BigInt(50)) / BigInt(100);
  return { errors, stone: Object.keys(errors).some(key => ["carats", "unitNetPrice", "priceBasis"].includes(key)) || stoneNet === null || vat === null ? null : { net: Number(stoneNet), vat: Number(vat), gross: Number(stoneNet + vat) } };
}
