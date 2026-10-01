import Dexie from "dexie";
import type { QuotesDatabase } from "../quotes/data/database";

const events = {
  auth: { level: "error", category: "auth", message: "Nie udało się obsłużyć logowania lub sesji." },
  sync: { level: "error", category: "sync", message: "Cykl synchronizacji nie został zakończony." },
  photo: { level: "error", category: "photo", message: "Nie udało się przesłać lub pobrać zdjęcia." },
  conflict: { level: "warning", category: "conflict", message: "Wykryto konflikt wymagający decyzji użytkownika." },
  database: { level: "error", category: "database", message: "Operacja lokalnej bazy nie powiodła się." },
  migration: { level: "error", category: "migration", message: "Nie udało się otworzyć lub zaktualizować schematu lokalnej bazy." },
  runtime: { level: "error", category: "runtime", message: "Nieoczekiwany wyjątek aplikacji." },
} as const;
export type LogEvent = keyof typeof events;
export type AppLog = { id: string; createdAt: string; level: "info" | "warning" | "error"; category: LogEvent; message: string; code?: string; quoteId?: string; photoId?: string };
const safeCodes = new Set(["QuotaExceededError", "SecurityError", "MissingAPIError", "UpgradeError", "VersionError", "DatabaseClosedError", "AbortError", "UnknownError", "42501", "23505", "invalid_credentials", "refresh_token_not_found"]);
export function safeId(value?: string) { return value && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : undefined; }
export function makeLog(event: LogEvent, error?: unknown, refs: { quoteId?: string; photoId?: string } = {}): AppLog {
  const source = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : {};
  const code = [source.code, source.name].find(value => typeof value === "string" && safeCodes.has(value)) as string | undefined;
  const kind = code === "UpgradeError" || code === "VersionError" ? "migration" : event;
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...events[kind], code, quoteId: safeId(refs.quoteId), photoId: safeId(refs.photoId) };
}
// Rebuild even read records from the allowlist before displaying/copying. No raw messages or stacks.
export function safeLog(log: AppLog): AppLog {
  const event = Object.hasOwn(events, log.category) ? log.category : "runtime";
  return { ...makeLog(event, { code: log.code }, log), id: safeId(log.id) ?? "unknown", createdAt: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(log.createdAt) ? log.createdAt : "unknown" };
}
export class LogRepository {
  private fallback: AppLog[] = [];
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  constructor(private readonly db: QuotesDatabase) {}
  record(event: LogEvent, error?: unknown, refs?: { quoteId?: string; photoId?: string }) {
    const row = makeLog(event, error, refs);
    // A native timer leaves BOTH the business transaction and liveQuery read-only scope.
    return new Promise<void>(resolve => {
      setTimeout(() => { void this.persist(row).then(resolve, resolve); }, 0);
    });
  }
  private async persist(row: AppLog) {
    // Diagnostics must never abort a quote/photo save.
    await Dexie.ignoreTransaction(async () => {
      try {
        await this.db.transaction("rw", this.db.appLogs, async () => {
          await this.db.appLogs.bulkPut([...this.fallback, row]);
          const excess = await this.db.appLogs.count() - 500;
          if (excess > 0) await this.db.appLogs.orderBy("createdAt").limit(excess).delete();
        });
        this.fallback = [];
      } catch { this.fallback = [...this.fallback, row].slice(-500); this.listeners.forEach(listener => listener()); }
    });
  }
  async recent() {
    try { return (await this.db.appLogs.orderBy("createdAt").reverse().limit(500).toArray()).concat(this.fallback).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500).map(safeLog); }
    catch { return [...this.fallback].reverse().map(safeLog); }
  }
  unavailable() { return this.fallback.length > 0; }
}
const repositories = new WeakMap<QuotesDatabase, LogRepository>();
export function logsFor(db: QuotesDatabase) {
  let repo = repositories.get(db);
  if (!repo) { repo = new LogRepository(db); repositories.set(db, repo); }
  return repo;
}
