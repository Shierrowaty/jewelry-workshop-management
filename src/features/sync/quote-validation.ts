import type { CloudQuote, CloudQuoteWrite } from "@/lib/supabase/database.types";
import { requireUuid } from "@/lib/supabase/mappers";
import type { QuoteSnapshot, SavedQuote } from "../quotes/data/types";
import type { CloudVersion } from "./types";
import { validQuoteExtension } from "../quotes/snapshot-extension";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown, keys: string[]) {
  return object(value) && keys.every(key => typeof value[key] === "string");
}
function integers(value: unknown, keys: string[]) {
  return object(value) && keys.every(key => Number.isSafeInteger(value[key]));
}
export function timeMicros(value: string) {
  const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Niepoprawna data w wycenie chmurowej. Dane lokalne zachowano.");
  }
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3));
}
export const cloudVersion = (row: CloudQuote): CloudVersion => ({ revision: row.revision, serverUpdatedAt: row.server_updated_at });
export function sameVersion(a: CloudVersion | null, b: CloudVersion | null) {
  return !!a && !!b && a.revision === b.revision && timeMicros(a.serverUpdatedAt) === timeMicros(b.serverUpdatedAt);
}

function validSnapshot(value: unknown): value is QuoteSnapshot {
  if (!object(value) || !strings(value, ["categoryName", "modelName", "vatRate", "agreedGross"])) return false;
  if (!validQuoteExtension(value)) return false;
  if (!strings(value.customer, ["name", "channel", "contact", "quoteDate"])) return false;
  if (!strings(value.product, ["categoryId", "modelId", "customName", "variant"]) || !object(value.product) || typeof value.product.customDesign !== "boolean") return false;
  if (!strings(value.gold, ["source", "fineness", "color", "mass", "customerMass", "purchasePerGram", "markupPerGram"]) || !object(value.gold) || !["ours", "customer", "mixed"].includes(String(value.gold.source))) return false;
  if (!Array.isArray(value.stones) || !value.stones.every(row => strings(row, ["id", "name", "quantity", "purchasePrice", "plannedProfit"]) && typeof row.customerOwned === "boolean")) return false;
  for (const lines of [value.labor, value.otherCosts]) if (!Array.isArray(lines) || !lines.every(row => strings(row, ["id", "name", "amount"]))) return false;
  const totals = value.totals;
  if (!object(totals) || !integers(totals, ["stoneCost", "materialCost", "externalCost", "totalCost", "stoneProfit", "labor", "plannedProfit", "calculatedNet", "calculatedGross", "priceAdjustment", "net", "vat", "gross", "profit"])) return false;
  if (!integers(totals.gold, ["ourMassMilligrams", "customerPricePerGram", "purchaseCost", "customerCharge", "profit"])) return false;
  const stoneTotals = totals.stones;
  if (!object(stoneTotals) || !Object.values(stoneTotals).every(row => integers(row, ["costPerUnit", "plannedProfitPerUnit", "valuePerUnit", "totalCost", "totalProfit", "totalValue"]))) return false;
  if (!value.stones.every(stone => Object.hasOwn(stoneTotals, stone.id))) return false;
  return typeof totals.manualPrice === "boolean" && [totals.marginPercent, totals.plannedMarginPercent].every(n => n === null || (typeof n === "number" && Number.isFinite(n)));
}

// Validate shape/version, never run the calculator or replace historical prices with catalog values.
export function validateCloudQuote(row: CloudQuote, workspaceId: string): asserts row is CloudQuote & { snapshot: QuoteSnapshot } {
  if (requireUuid(row.workspace_id) !== requireUuid(workspaceId)) throw new Error("Odrzucono wycenę z innego workspace.");
  requireUuid(row.id);
  if (row.schema_version !== 2 || row.calculation_version !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1 || !validSnapshot(row.snapshot)) {
    throw new Error("Nieobsługiwana wersja lub uszkodzony snapshot wyceny w chmurze. Zaktualizuj aplikację; dane lokalne zachowano.");
  }
  if (typeof row.status !== "string" || typeof row.notes !== "string" || !(row.due_date === null || /^\d{4}-\d\d-\d\d$/.test(row.due_date))) throw new Error("Niepoprawne dane zamówienia w chmurze.");
  [row.created_at, row.updated_at, row.server_updated_at].forEach(timeMicros);
  [row.completed_at, row.deleted_at].forEach(value => { if (value !== null) timeMicros(value); });
}

export function quoteFromCloud(row: CloudQuote, workspaceId: string, current?: SavedQuote): SavedQuote {
  validateCloudQuote(row, workspaceId);
  return {
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    status: row.status, dueDate: row.due_date ?? "", notes: row.notes,
    schemaVersion: 2, calculationVersion: 1, syncStatus: "synced",
    // Local UI revision never goes backwards, even when two devices use different counters.
    revision: current ? Math.max(current.revision + 1, row.revision) : row.revision,
    snapshot: structuredClone(row.snapshot),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function sameCloudContent(a: CloudQuoteWrite, b: CloudQuoteWrite) {
  const normalize = (row: CloudQuoteWrite) => {
    const { server_updated_at: ignored, ...fields } = row as CloudQuote;
    void ignored;
    return { ...fields, created_at: timeMicros(row.created_at).toString(), updated_at: timeMicros(row.updated_at).toString(), completed_at: row.completed_at ? timeMicros(row.completed_at).toString() : null, deleted_at: row.deleted_at ? timeMicros(row.deleted_at).toString() : null };
  };
  return JSON.stringify(canonical(normalize(a))) === JSON.stringify(canonical(normalize(b)));
}
