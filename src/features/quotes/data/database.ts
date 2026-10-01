import type { SavedCalculation, CalculationTransfer } from "../../calculator/repository";
import type { KnowledgeSyncState } from "../../knowledge/sync/types";
import type { KnowledgeCategory, KnowledgeEntry } from "../../knowledge/types";
import { logsFor, type AppLog } from "../../diagnostics/logs";
import Dexie, { type DexieOptions, type Table } from "dexie";
import type { SavedQuote } from "./types";
import type { QuotePhoto } from "../photos/types";
import type { QuoteSyncState, SyncWorkspace } from "../../sync/types";
import type { PhotoSyncState } from "../../sync/photos/types";

export const QUOTES_DATABASE_NAME = "jewelry-workshop-demo";

export class QuotesDatabase extends Dexie {
  calculations!: Table<SavedCalculation, string>;
  calculationTransfers!: Table<CalculationTransfer, string>;
  knowledgeSync!: Table<KnowledgeSyncState, string>;
  knowledgeCategories!: Table<KnowledgeCategory, string>;
  knowledgeEntries!: Table<KnowledgeEntry, string>;
  appLogs!: Table<AppLog, string>;
  quotes!: Table<SavedQuote, string>;
  quotePhotos!: Table<QuotePhoto, string>;
  quoteSync!: Table<QuoteSyncState, string>;
  syncSettings!: Table<SyncWorkspace, string>;
  photoSync!: Table<PhotoSyncState, string>;

  constructor(name = QUOTES_DATABASE_NAME, options?: DexieOptions) {
    super(name, {
      ...options,
      chromeTransactionDurability: "strict",
      // Publish committed data only; no optimistic IndexedDB query cache.
      cache: "disabled",
    });
    this.version(1).stores({ quotes: "&id, createdAt, updatedAt, syncStatus" });
    this.version(2)
      .stores({ quotes: "&id, createdAt, updatedAt, syncStatus, completedAt" })
      .upgrade((transaction) => transaction.table("quotes").toCollection().modify((quote) => {
        // Structural migration only: keep every snapshot, timestamp and revision intact.
        quote.completedAt = null;
        quote.schemaVersion = 2;
      }));
    // Additive migration: quote records (including completed ones) remain untouched.
    this.version(3).stores({
      quotes: "&id, createdAt, updatedAt, syncStatus, completedAt",
      quotePhotos: "&id, quoteId, createdAt, updatedAt, syncStatus, deletedAt",
    });
    // Sidecar metadata only. Existing quote/photo records and pending/local states stay intact.
    this.version(4).stores({ quoteSync: "&quoteId", syncSettings: "&key" });
    // B2 adds only a journal. Existing Blobs, UUIDs and deletion markers are untouched.
    this.version(5).stores({ photoSync: "&photoId, quoteId, phase" });
    // Additive only: no existing snapshots, Blobs or sync journals are rewritten.
    this.version(6).stores({ appLogs: "&id, createdAt, level, category" });
    // Independent manual reference data. No imports or mutations of quote/photo/sync records.
    this.version(7).stores({ knowledgeCategories: "&id, parentId", knowledgeEntries: "&id, categoryId, subcategoryId, kind, updatedAt, archivedAt" });
    // Durable knowledge acknowledgements, conflicts and deletions; existing records stay intact.
    this.version(8).stores({ knowledgeSync: "&key, table, id" });
    // Calculator snapshots are local and independent of quotes and cloud journals.
    this.version(9).stores({ calculations: "&id, updatedAt", calculationTransfers: "&id, createdAt" });
  }
}

let database: QuotesDatabase | undefined;
export function getLocalDatabase(): QuotesDatabase {
  if (typeof window === "undefined") throw new Error("Lokalna baza jest dostępna tylko w przeglądarce.");
  if (!database) {
    database = new QuotesDatabase();
    const current = database;
    void current.open().catch(error => logsFor(current).record("migration", error));
  }
  return database;
}
