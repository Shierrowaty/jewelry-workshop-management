import type { ProductCatalog, QuoteDraft } from "../types";
import { getLocalDatabase, type QuotesDatabase } from "./database";
import type { QuoteMetadata, SavedQuote } from "./types";
import { snapshotFromDraft } from "./snapshot";
import { notifyQuoteSaved } from "./events";

export class InvalidQuoteError extends Error {
  constructor() {
    super("Popraw zaznaczone pola przed zapisaniem wyceny.");
    this.name = "InvalidQuoteError";
  }
}

export class QuoteConflictError extends Error {
  constructor() {
    super("Ta wycena została zmieniona w innym oknie. Wczytaj aktualne dane przed ponownym zapisem.");
    this.name = "QuoteConflictError";
  }
}

export class QuoteNotFoundError extends Error {
  constructor() {
    super("Nie znaleziono tej wyceny w lokalnej bazie.");
    this.name = "QuoteNotFoundError";
  }
}

export interface QuoteRepository {
  create(draft: QuoteDraft, catalog: ProductCatalog): Promise<SavedQuote>;
  list(): Promise<SavedQuote[]>;
  get(id: string): Promise<SavedQuote | undefined>;
  updateMetadata(id: string, expectedRevision: number, metadata: QuoteMetadata): Promise<SavedQuote>;
  updateQuote(id: string, expectedRevision: number, draft: QuoteDraft, catalog: ProductCatalog): Promise<SavedQuote>;
  setCompleted(id: string, expectedRevision: number, completed: boolean): Promise<SavedQuote>;
}

export class LocalQuoteRepository implements QuoteRepository {
  constructor(private readonly database: QuotesDatabase) {}

  async create(draft: QuoteDraft, catalog: ProductCatalog): Promise<SavedQuote> {
    // Clone before the first await, so in-flight form/catalog changes cannot alter the save.
    const values = snapshotFromDraft(draft, catalog);
    if (!values) throw new InvalidQuoteError();
    const timestamp = new Date().toISOString();
    const record: SavedQuote = {
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      syncStatus: "pending",
      schemaVersion: 2,
      calculationVersion: 1,
      revision: 1,
      completedAt: null,
      ...values,
    };
    // The returned promise resolves after the entire transaction commits.
    await this.database.transaction("rw", this.database.quotes, async () => {
      await this.database.quotes.add(record);
    });
    notifyQuoteSaved();
    return record;
  }

  list() {
    return this.database.quotes.orderBy("createdAt").reverse().toArray();
  }

  get(id: string) {
    return this.database.quotes.get(id);
  }

  async updateMetadata(id: string, expectedRevision: number, metadata: QuoteMetadata): Promise<SavedQuote> {
    const patch = structuredClone(metadata);
    return this.updateRecord(id, expectedRevision, () => ({ status: patch.status, dueDate: patch.dueDate, notes: patch.notes }));
  }

  async updateQuote(id: string, expectedRevision: number, draft: QuoteDraft, catalog: ProductCatalog): Promise<SavedQuote> {
    const input = structuredClone(draft);
    const catalogSnapshot = structuredClone(catalog);
    return this.updateRecord(id, expectedRevision, (current) => {
      const values = snapshotFromDraft(input, catalogSnapshot, current.snapshot);
      if (!values) throw new InvalidQuoteError();
      return { ...values, calculationVersion: 1 };
    });
  }

  async setCompleted(id: string, expectedRevision: number, completed: boolean): Promise<SavedQuote> {
    return this.updateRecord(id, expectedRevision, (current, timestamp) => ({
      completedAt: completed ? current.completedAt ?? timestamp : null,
    }));
  }

  private async updateRecord(
    id: string,
    expectedRevision: number,
    change: (current: SavedQuote, timestamp: string) => Partial<Pick<SavedQuote, "snapshot" | "status" | "dueDate" | "notes" | "completedAt" | "calculationVersion">>,
  ): Promise<SavedQuote> {
    const result = await this.database.transaction("rw", this.database.quotes, async () => {
      const current = await this.database.quotes.get(id);
      if (!current) throw new QuoteNotFoundError();
      if (current.revision !== expectedRevision) throw new QuoteConflictError();
      const timestamp = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
      const updated: SavedQuote = {
        ...current,
        ...change(current, timestamp),
        updatedAt: timestamp,
        revision: current.revision + 1,
        syncStatus: current.syncStatus === "conflict" ? "conflict" : "pending",
      };
      // All mutations share the same atomic revision check and local commit.
      await this.database.quotes.put(updated);
      return updated;
    });
    notifyQuoteSaved();
    return result;
  }
}

let repository: QuoteRepository | undefined;

export function getQuoteRepository(): QuoteRepository {
  if (typeof window === "undefined") throw new Error("Lokalna baza jest dostępna tylko w przeglądarce.");
  repository ??= new LocalQuoteRepository(getLocalDatabase());
  return repository;
}
