import { expect, test } from "@playwright/test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import Dexie from "dexie";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { LogRepository, makeLog, safeLog } from "../src/features/diagnostics/logs";
import { diagnosticReport, originWarning } from "../src/features/diagnostics/report";
import { displayName, greeting } from "../src/features/account/display-name";
import { LocalSyncRepository } from "../src/features/sync/local-sync-repository";
import { LocalQuoteRepository } from "../src/features/quotes/data/quote-repository";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { exampleCatalog } from "../src/features/quotes/catalog";
import type { SyncView } from "../src/features/sync/sync-controller";
const workspaceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const scope = { projectUrl: "https://example.invalid", workspaceId };
function database(indexedDB = new IDBFactory()) { return new QuotesDatabase("diagnostics-test", { indexedDB, IDBKeyRange }); }
test("mapa imion i neutralne powitanie", () => {
  expect(displayName(" Demo@example.invalid ")).toBe("Demo");
  expect(displayName("WORKSHOP@example.invalid")).toBe("Pracownia");
  expect(displayName("unknown@example.invalid")).toBeNull();
  expect(greeting()).toEqual({ title: "Witaj 👋", subtitle: "Miło Cię widzieć" });
  expect(greeting("other@example.invalid")).toEqual(greeting());
  expect(greeting("workshop@example.invalid").title).toBe("Witaj, Pracownia 👋");
});
test("logi nie kopiują treści wyjątku, sekretów ani obcych pól", () => {
  const secret = "password=secret access_token=secret refresh_token=secret service_role=secret klient=Kowalski";
  const error = Object.assign(new Error(secret), { code: secret, name: secret, snapshot: secret });
  const row = makeLog("auth", error, { quoteId: secret, photoId: secret });
  expect(JSON.stringify(row)).not.toContain("secret");
  expect(row.code).toBeUndefined(); expect(row.quoteId).toBeUndefined();
  expect(makeLog("database", { name: "QuotaExceededError" }).code).toBe("QuotaExceededError");
  expect(makeLog("database", { name: "UpgradeError" }).category).toBe("migration");
  expect(JSON.stringify(safeLog({ ...row, message: secret, code: secret }))).not.toContain("secret");
});
test("logi są trwałe, retencja zachowuje najwyżej 500 i nie dotyka wycen", async () => {
  const factory = new IDBFactory(); let db = database(factory);
  const quote = await new LocalQuoteRepository(db).create(createEmptyQuote("2026-09-05"), exampleCatalog);
  const repo = new LogRepository(db);
  // Distinct times make retention order deterministic even on fast machines.
  await db.appLogs.bulkAdd(Array.from({ length: 500 }, (_, i) => ({ ...makeLog("sync"), createdAt: new Date(1700000000000 + i).toISOString() })));
  await Promise.all([repo.record("auth"), repo.record("photo")]);
  expect(await db.appLogs.count()).toBe(500);
  expect(await db.appLogs.orderBy("createdAt").first()).toMatchObject({ createdAt: new Date(1700000000002).toISOString() });
  expect(await db.quotes.get(quote.id)).toEqual(quote);
  db.close(); db = database(factory);
  expect(await db.appLogs.count()).toBe(500); expect(await db.quotes.get(quote.id)).toEqual(quote); db.close();
});
test("niedostępna baza nie odrzuca logowania i zachowuje bezpieczny wpis w pamięci", async () => {
  const db = database(); await db.open(); db.close({ disableAutoOpen: true });
  const repo = new LogRepository(db);
  await repo.record("database", { name: "UpgradeError", message: "secret" });
  expect(repo.unavailable()).toBe(true); expect(await repo.recent()).toHaveLength(1);
  expect(JSON.stringify(await repo.recent())).not.toContain("secret");
  await db.open(); await repo.record("sync"); expect(repo.unavailable()).toBe(false); expect(await db.appLogs.count()).toBe(2); db.close();
});
test("pełny sukces jest trwały; otwarcie, B1, pending i konflikt nie zmieniają daty", async () => {
  const factory = new IDBFactory(); let db = database(factory); let repo = new LocalSyncRepository(db);
  await repo.bind(scope.projectUrl, { id: workspaceId, name: "Test" });
  await repo.finish(scope); expect((await repo.binding())?.lastSuccessfulSyncAt).toBeNull();
  await repo.finishFullSync(scope); const date = (await repo.binding())?.lastSuccessfulSyncAt; expect(date).toBeTruthy();
  const quote = await new LocalQuoteRepository(db).create(createEmptyQuote("2026-09-05"), exampleCatalog);
  expect(await repo.finishFullSync(scope)).toBe(false);
  await db.quotes.update(quote.id, { syncStatus: "conflict" }); expect(await repo.finishFullSync(scope)).toBe(false);
  await db.quotes.update(quote.id, { syncStatus: "synced" });
  await db.photoSync.put({ photoId: crypto.randomUUID(), quoteId: quote.id, base: null, inFlight: null, phase: "download", conflict: null, error: null });
  expect(await repo.finishFullSync(scope)).toBe(false); expect((await repo.binding())?.lastSuccessfulSyncAt).toBe(date);
  db.close(); db = database(factory); repo = new LocalSyncRepository(db);
  expect((await repo.binding())?.lastSuccessfulSyncAt).toBe(date); db.close();
});
test("migracja v5 do v6 dodaje tylko appLogs, zachowuje dane i stary czas B1", async () => {
  const factory = new IDBFactory(); const old = new Dexie("diagnostics-test", { indexedDB: factory, IDBKeyRange });
  old.version(5).stores({ quotes: "&id, createdAt, updatedAt, syncStatus, completedAt", quotePhotos: "&id, quoteId, createdAt, updatedAt, syncStatus, deletedAt", quoteSync: "&quoteId", syncSettings: "&key", photoSync: "&photoId, quoteId, phase" });
  const photo = { id: crypto.randomUUID(), blob: new Blob(["unchanged"]), quoteId: crypto.randomUUID() };
  const binding = { key: "workspace", ...scope, lastSyncedAt: "2020-01-01T00:00:00.000Z" };
  await old.table("quotePhotos").put(photo); await old.table("syncSettings").put(binding); old.close();
  const db = database(factory); await db.open(); expect(db.verno).toBe(9);
  expect(await db.quotePhotos.get(photo.id)).toEqual(photo); expect(await db.syncSettings.get("workspace")).toEqual(binding);
  expect(await db.appLogs.count()).toBe(0); db.close();
});
test("raport zawiera tylko bezpieczne metadane i liczniki", () => {
  const view: SyncView = { ready: true, user: { id: "secret", email: "secret" }, workspace: { id: workspaceId, name: "secret" }, online: false, busy: false, message: "secret", summary: { knowledgePending: 0, knowledgeConflicts: 0, binding: { key: "workspace", ...scope, workspaceName: "secret", lastSyncedAt: null, lastSuccessfulSyncAt: null }, total: 2, pending: 1, photoPending: 2, conflicts: [{ id: "secret", name: "secret" }], photoConflicts: [{ id: "secret", quoteId: "secret", message: "secret" }] } };
  const report = diagnosticReport(view, [makeLog("sync", new Error("secret"))], "https://secret.invalid/path?token=secret");
  expect(report).not.toContain("secret"); expect(JSON.parse(report)).toMatchObject({ auth: "signed-in", origin: "inne", pendingQuotes: 1, pendingPhotos: 2, quoteConflicts: 1, photoConflicts: 1, workspaceId, lastSuccessfulSyncAt: null });
});
test("ostrzeżenie originu tylko w development, uwzględnia host i port", () => {
  expect(originWarning("http://127.0.0.1:3000", true)).toBeNull();
  expect(originWarning("http://localhost:3000", true)).toContain("osobną lokalną bazę");
  expect(originWarning("http://127.0.0.1:3001", true)).toBeTruthy();
  expect(originWarning("http://localhost:3000", false)).toBeNull();
});

test("błąd odczytu z liveQuery zapisuje log poza kontekstem tylko do odczytu", async () => {
  const previous = { ...Dexie.dependencies };
  const factory = new IDBFactory();
  Dexie.dependencies.indexedDB = factory; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  const db = database(factory); const repo = new LogRepository(db);
  await db.open();
  try { await new Promise<void>((resolve, reject) => {
    const subscription = Dexie.liveQuery(async () => { await repo.record("database"); return db.quotes.count(); }).subscribe({
      next: () => { subscription.unsubscribe(); resolve(); }, error: reject,
    });
  });
  expect(await db.appLogs.count()).toBe(1); expect(repo.unavailable()).toBe(false);
  } finally { db.close(); Object.assign(Dexie.dependencies, previous); }
});
