import type { QuoteDraft } from "../quotes/types";
import { calculateQuote } from "../quotes/calculations";
import { createEmptyQuote, getQuoteDate } from "../quotes/defaults";
import { getLocalDatabase, type QuotesDatabase } from "../quotes/data/database";
export type SavedCalculation = { id: string; revision: number; schemaVersion: 1; name: string; createdAt: string; updatedAt: string; draft: QuoteDraft };
export type CalculationTransfer = { id: string; createdAt: string; name: string; draft: QuoteDraft };
export class CalculatorError extends Error {}
export class CalculatorRepository {
  constructor(private readonly db: QuotesDatabase) {}
  list() { return this.db.calculations.orderBy("updatedAt").reverse().toArray(); }
  get(id: string) { return this.db.calculations.get(id); }
  private validate(draft: QuoteDraft) {
    if (draft.pricing?.model !== "net-costs-v1" || !calculateQuote(draft).totals) throw new CalculatorError("Popraw zaznaczone pola przed zapisaniem kalkulacji.");
  }
  async save(name: string, draft: QuoteDraft, previous?: Pick<SavedCalculation, "id" | "revision">) {
    const input = structuredClone(draft), trimmed = name.trim();
    if (!trimmed) throw new CalculatorError("Podaj nazwę kalkulacji.");
    this.validate(input);
    return this.db.transaction("rw", this.db.calculations, async () => {
      const current = previous ? await this.get(previous.id) : undefined;
      if (previous && (!current || current.revision !== previous.revision)) throw new CalculatorError("Kalkulację zmieniono w innym oknie. Otwórz jej aktualną wersję przed zapisem.");
      const timestamp = new Date(Math.max(Date.now(), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
      const saved: SavedCalculation = { id: current?.id ?? crypto.randomUUID(), revision: (current?.revision ?? 0) + 1, schemaVersion: 1, name: trimmed, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp, draft: input };
      await this.db.calculations.put(saved); return saved;
    });
  }
  async transfer(name: string, draft: QuoteDraft) {
    const input = structuredClone(draft); this.validate(input);
    const timestamp = new Date().toISOString(), fresh = createEmptyQuote(getQuoteDate(new Date(timestamp)));
    // A separate durable snapshot: no existing quote is created or overwritten.
    const transferred: QuoteDraft = { ...fresh, pricing: input.pricing, agreedGross: input.agreedGross, vatRate: input.vatRate,
      product: { ...fresh.product, weight: input.product.weight, goldColor: input.product.goldColor, customDesign: !!name.trim(), customName: name.trim() },
      gold: input.gold, stones: input.stones, otherCosts: input.otherCosts, labor: input.labor };
    const record: CalculationTransfer = { id: crypto.randomUUID(), createdAt: timestamp, name: name.trim(), draft: transferred };
    await this.db.calculationTransfers.add(record); return record;
  }
}
export const getCalculatorRepository = () => new CalculatorRepository(getLocalDatabase());
