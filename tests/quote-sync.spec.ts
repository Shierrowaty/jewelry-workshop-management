import { expect, test } from "@playwright/test";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { LocalQuoteRepository } from "../src/features/quotes/data/quote-repository";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { exampleCatalog } from "../src/features/quotes/catalog";
import { LocalSyncRepository } from "../src/features/sync/local-sync-repository";
import { QuoteSyncEngine } from "../src/features/sync/sync-engine";
import { cloudVersion, sameVersion, timeMicros } from "../src/features/sync/quote-validation";
import { quoteToCloud } from "../src/lib/supabase/mappers";
import type { CloudQuote, CloudQuoteWrite } from "../src/lib/supabase/database.types";
import type { ChangeCursor } from "../src/lib/supabase/cloud-repository";
import type { CloudVersion, QuoteSyncRemote } from "../src/features/sync/types";
import type { SavedQuote } from "../src/features/quotes/data/types";

const projectUrl = "https://sync-test.example";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "10000000-0000-4000-8000-000000000002";
const workspace = { id: workspaceId, name: "Testowa pracownia" };
const scope = { projectUrl, workspaceId };
const databases: QuotesDatabase[] = [];

class FakeCloud implements QuoteSyncRemote {
  readonly workspaceId = workspace.id;
  rows = new Map<string, CloudQuote>();
  writes = 0;
  reads = 0;
  offline = false;
  failAfterWrite = false;
  afterWrite?: () => Promise<void>;
  beforeWrite?: () => Promise<void>;
  private tick = 0;
  private stamp() { return new Date(Date.UTC(2026, 8, 4, 12, 0, ++this.tick)).toISOString(); }
  private check() { if (this.offline) throw new Error("offline"); }
  put(row: CloudQuoteWrite) { const saved = { ...structuredClone(row), server_updated_at: this.stamp() }; this.rows.set(row.id, saved); return saved; }
  external(id: string, notes = "Zmiana na drugim urządzeniu") {
    const current = this.rows.get(id)!;
    return this.put({ ...current, notes, revision: current.revision + 1, updated_at: "2000-01-01T00:00:00.000Z" });
  }
  async getQuote(id: string) { this.check(); return structuredClone(this.rows.get(id) ?? null); }
  async fetchChangedQuotes(cursor?: ChangeCursor, limit = 100) {
    this.check(); this.reads++;
    return structuredClone([...this.rows.values()].sort((a,b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id))
      .filter(row => !cursor || row.server_updated_at > cursor.serverUpdatedAt || (row.server_updated_at === cursor.serverUpdatedAt && row.id > cursor.id)).slice(0,limit));
  }
  async saveQuoteConditionally(row: CloudQuoteWrite, base: CloudVersion | null) {
    this.check();
    if (row.workspace_id !== this.workspaceId) throw new Error("foreign workspace");
    await this.beforeWrite?.();
    const current = this.rows.get(row.id);
    if (base ? !current || !sameVersion(base, cloudVersion(current)) : current) return null;
    const saved = this.put(row); this.writes++;
    await this.afterWrite?.();
    if (this.failAfterWrite) { this.failAfterWrite = false; throw new Error("Response lost after commit"); }
    return structuredClone(saved);
  }
}

async function device() {
  const db = new QuotesDatabase(`sync-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
  databases.push(db);
  const local = new LocalSyncRepository(db);
  await local.bind(projectUrl, workspace);
  return { db, local, quotes: new LocalQuoteRepository(db), run: (cloud: FakeCloud, check?: () => void) => new QuoteSyncEngine(local, cloud, projectUrl, check).run() };
}
async function quote(d: Awaited<ReturnType<typeof device>>) {
  const draft = createEmptyQuote("2026-09-04");
  draft.customer.name = "Wycena testowa"; draft.product.weight = "5,5"; draft.gold.purchasePerGram = "350";
  return d.quotes.create(draft, exampleCatalog);
}
async function edit(d: Awaited<ReturnType<typeof device>>, id: string, notes: string) {
  const saved = (await d.quotes.get(id))!;
  return d.quotes.updateMetadata(id, saved.revision, { notes, status: saved.status, dueDate: saved.dueDate });
}
test.afterEach(() => { databases.splice(0).forEach(db => db.close()); });

test("istniejące local/pending wysyłają dokładny snapshot i zachowują UUID, daty oraz lokalną rewizję", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.db.quotes.update(original.id, { syncStatus: "local", revision: 7 });
  await d.run(cloud);
  expect(cloud.rows.get(original.id)).toMatchObject({ id: original.id, workspace_id: workspaceId, created_at: original.createdAt, snapshot: original.snapshot });
  expect(await d.quotes.get(original.id)).toEqual({ ...original, revision: 7, syncStatus: "synced" });
  expect((await d.local.conflict(original.id))?.base?.revision).toBe(1);
});

test("cloud-only trafia na drugie urządzenie i wielokrotne uruchomienie nie tworzy duplikatów", async () => {
  const a = await device(), b = await device(), cloud = new FakeCloud(), original = await quote(a);
  await a.run(cloud); await b.run(cloud); await b.run(cloud); await a.run(cloud);
  expect(await b.quotes.list()).toEqual([{ ...original, syncStatus: "synced" }]);
  expect(cloud.rows.size).toBe(1); expect(cloud.writes).toBe(1);
});

test("synced przyjmuje nowszą chmurę mimo cofniętego zegara klienta i unieważnia otwarty formularz", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud); cloud.external(original.id);
  await d.run(cloud);
  expect(await d.quotes.get(original.id)).toMatchObject({ notes: "Zmiana na drugim urządzeniu", syncStatus: "synced", revision: 2, snapshot: original.snapshot });
  await expect(d.quotes.updateMetadata(original.id, 1, { notes: "stare", status: "Wycena", dueDate: "" })).rejects.toThrow("innym oknie");
});

test("lokalna zmiana podczas uploadu pozostaje pending, ale baza chmurowa jest zapamiętana", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  cloud.afterWrite = async () => { cloud.afterWrite = undefined; await edit(d, original.id, "Zmiana w trakcie"); };
  await d.run(cloud);
  expect(await d.quotes.get(original.id)).toMatchObject({ notes: "Zmiana w trakcie", syncStatus: "pending", revision: 2 });
  expect((await d.local.conflict(original.id))?.base?.revision).toBe(1);
  await d.run(cloud);
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("synced");
  expect(cloud.rows.get(original.id)?.notes).toBe("Zmiana w trakcie");
});

test("pending i zmieniona chmura zachowują obie wersje jako conflict, także po kolejnej edycji", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud); await edit(d, original.id, "Moja wersja"); cloud.external(original.id);
  await d.run(cloud);
  expect(await d.quotes.get(original.id)).toMatchObject({ notes: "Moja wersja", syncStatus: "conflict" });
  expect((await d.local.conflict(original.id))?.conflict?.notes).toBe("Zmiana na drugim urządzeniu");
  await edit(d, original.id, "Dalsza lokalna edycja"); await d.run(cloud);
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("conflict");
  expect(cloud.writes).toBe(1);
});

test("CAS wykrywa zmianę chmury pomiędzy pull i push", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud); await edit(d, original.id, "Moja wersja");
  cloud.beforeWrite = async () => { cloud.beforeWrite = undefined; cloud.external(original.id); };
  await d.run(cloud);
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("conflict");
  expect(cloud.rows.get(original.id)?.notes).toBe("Zmiana na drugim urządzeniu");
});

test("świadome zachowanie lokalnej wersji używa nowej bazy, a kolejny wyścig ponownie tworzy konflikt", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud); await edit(d, original.id, "Moja wersja"); cloud.external(original.id); await d.run(cloud);
  let saved = (await d.quotes.get(original.id))!, remote = (await d.local.conflict(original.id))!.conflict!;
  await d.local.resolve(original.id, saved.revision, remote, "local", scope);
  cloud.external(original.id, "Jeszcze nowsza"); await d.run(cloud);
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("conflict");
  saved = (await d.quotes.get(original.id))!; remote = (await d.local.conflict(original.id))!.conflict!;
  await d.local.resolve(original.id, saved.revision, remote, "local", scope); await d.run(cloud);
  expect(cloud.rows.get(original.id)?.notes).toBe("Moja wersja");
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("synced");
});

test("wybór chmury zastępuje snapshot lokalny i nie wysyła starej wersji", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud); await edit(d, original.id, "Moja wersja"); cloud.external(original.id); await d.run(cloud);
  const saved = (await d.quotes.get(original.id))!, remote = (await d.local.conflict(original.id))!.conflict!;
  await d.local.resolve(original.id, saved.revision, remote, "cloud", scope); await d.run(cloud);
  expect(await d.quotes.get(original.id)).toMatchObject({ notes: remote.notes, syncStatus: "synced", revision: saved.revision + 1 });
  expect(cloud.writes).toBe(1);
});

test("decyzja z nieaktualnego okna nie nadpisuje lokalnej zmiany", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud); await edit(d, original.id, "A"); cloud.external(original.id); await d.run(cloud);
  const saved = (await d.quotes.get(original.id))!, remote = (await d.local.conflict(original.id))!.conflict!;
  await edit(d, original.id, "B");
  await expect(d.local.resolve(original.id, saved.revision, remote, "cloud", scope)).rejects.toThrow("Dane zmieniły");
  expect((await d.quotes.get(original.id))?.notes).toBe("B");
});

test("offline nie zmienia danych; ponowienie wysyła pending", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  cloud.offline = true;
  await expect(d.run(cloud)).rejects.toThrow("offline");
  expect(await d.quotes.get(original.id)).toEqual(original);
  cloud.offline = false; await d.run(cloud);
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("synced");
});

test("utracona odpowiedź po zapisie jest rozpoznana po ponownym otwarciu Dexie", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  cloud.failAfterWrite = true;
  await expect(d.run(cloud)).rejects.toThrow("Response lost");
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("pending");
  d.db.close(); await d.db.open(); await d.run(cloud);
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("synced");
  expect(cloud.writes).toBe(1);
});

test("utracona odpowiedź i późniejsza edycja zachowują pending do wysłania nowej treści", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  cloud.failAfterWrite = true; await expect(d.run(cloud)).rejects.toThrow();
  await edit(d, original.id, "Po przerwaniu"); await d.run(cloud);
  expect(cloud.rows.get(original.id)?.notes).toBe("Po przerwaniu");
  expect(cloud.writes).toBe(2);
});

test("przerwanie sesji po odpowiedzi nie potwierdza zapisu, a ponowienie bezpiecznie go rozpoznaje", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  let stopped = false; cloud.afterWrite = async () => { stopped = true; };
  await expect(d.run(cloud, () => { if (stopped) throw new Error("signed out"); })).rejects.toThrow("signed out");
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("pending");
  cloud.afterWrite = undefined; await d.run(cloud); expect(cloud.writes).toBe(1);
});

test("powiązanie bazy z innym workspace lub projektem nie jest zmieniane", async () => {
  const d = await device(); await quote(d);
  await expect(d.local.bind(projectUrl, { id: otherWorkspaceId, name: "Obca" })).rejects.toThrow("inną pracownią");
  await expect(d.local.bind("https://other.example", workspace)).rejects.toThrow("inną pracownią");
  expect((await d.local.binding())?.workspaceId).toBe(workspaceId);
  expect(await d.quotes.list()).toHaveLength(1);
});

test("brak potwierdzonego powiązania blokuje wysyłkę istniejących danych", async () => {
  const d = await device(), cloud = new FakeCloud(); await quote(d);
  await d.db.syncSettings.delete("workspace");
  await expect(d.run(cloud)).rejects.toThrow("powiązania"); expect(cloud.writes).toBe(0);
});

test("rekord obcego workspace i uszkodzony snapshot nie trafiają do Dexie", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  const foreign = cloud.put({ ...quoteToCloud(original, otherWorkspaceId), id: crypto.randomUUID() });
  await expect(d.local.applyCloud(foreign, scope)).rejects.toThrow("innego workspace");
  const corrupt = { ...foreign, workspace_id: workspaceId, snapshot: {} };
  await expect(d.local.applyCloud(corrupt, scope)).rejects.toThrow("snapshot");
  const missingStoneTotals = { ...corrupt, snapshot: { ...original.snapshot, stones: [{ id: "stone-without-result", name: "Kamień", quantity: "1", purchasePrice: "200", plannedProfit: "", customerOwned: false }] } };
  await expect(d.local.applyCloud(missingStoneTotals, scope)).rejects.toThrow("snapshot");
  expect(await d.quotes.list()).toEqual([original]);
});

test("nieznana wersja schematu nie jest przeliczana ani importowana", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  cloud.put({ ...quoteToCloud(original, workspaceId), schema_version: 99 });
  await expect(d.run(cloud)).rejects.toThrow("Nieobsługiwana wersja");
  expect(await d.quotes.get(original.id)).toEqual(original);
});

test("stronicowanie pobiera ponad 100 rekordów oraz opóźniony commit za poprzednim kursorem", async () => {
  const a = await device(), b = await device(), cloud = new FakeCloud(), original = await quote(a);
  for (let n = 0; n < 105; n++) cloud.put({ ...quoteToCloud(original, workspaceId), id: crypto.randomUUID() });
  await b.run(cloud); expect(await b.quotes.list()).toHaveLength(105);
  const late = { ...quoteToCloud(original, workspaceId), id: crypto.randomUUID(), server_updated_at: "2026-09-04T11:00:00.000Z" };
  cloud.rows.set(late.id, late); await b.run(cloud);
  expect(await b.quotes.list()).toHaveLength(106); expect(cloud.reads).toBeGreaterThan(4);
});

test("znacznik usunięcia nie kasuje lokalnej wyceny i nie powoduje jej automatycznego odtworzenia", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud);
  cloud.put({ ...cloud.rows.get(original.id)!, deleted_at: "2026-09-04T13:00:00Z", revision: 2 });
  await d.run(cloud);
  expect(await d.quotes.get(original.id)).toMatchObject({ snapshot: original.snapshot, syncStatus: "conflict" });
  expect(cloud.writes).toBe(1);
});

test("migracja v3 → v4 zachowuje wyceny i bajty zdjęć, dodając wyłącznie puste metadane sync", async () => {
  const options = { indexedDB: new IDBFactory(), IDBKeyRange }, name = `migration-${crypto.randomUUID()}`;
  const originalDevice = await device(), original = await quote(originalDevice);
  const legacy = new Dexie(name, options);
  legacy.version(3).stores({ quotes: "&id, createdAt, updatedAt, syncStatus, completedAt", quotePhotos: "&id, quoteId, createdAt, updatedAt, syncStatus, deletedAt" });
  await legacy.table<SavedQuote>("quotes").add({ ...original, syncStatus: "local" });
  await legacy.table("quotePhotos").add({ id: "legacy-photo", quoteId: original.id, blob: new Blob(["exact bytes"]), syncStatus: "pending" });
  legacy.close();
  const current = new QuotesDatabase(name, options); databases.push(current); await current.open();
  expect(current.verno).toBe(9); expect(await current.quotes.toArray()).toEqual([{ ...original, syncStatus: "local" }]);
  expect(await (await current.quotePhotos.get("legacy-photo"))!.blob!.text()).toBe("exact bytes");
  expect(await current.quoteSync.count()).toBe(0); expect(await current.syncSettings.count()).toBe(0);
});

test("wersja chmurowa zachowuje mikrosekundy i rozpoznaje równoważne strefy czasu", () => {
  expect(timeMicros("2026-09-04T12:00:00.123456Z")).toBe(timeMicros("2026-09-04T14:00:00.123456+02:00"));
  expect(sameVersion({ revision: 2, serverUpdatedAt: "2026-09-04T12:00:00.123456Z" }, { revision: 2, serverUpdatedAt: "2026-09-04T12:00:00.123457Z" })).toBe(false);
});

test("dwa urządzenia zapisujące od wspólnej bazy nie nadpisują się wzajemnie", async () => {
  const a = await device(), b = await device(), cloud = new FakeCloud(), original = await quote(a);
  await a.run(cloud); await b.run(cloud);
  await edit(a, original.id, "Urządzenie A"); await edit(b, original.id, "Urządzenie B");
  await Promise.all([a.run(cloud), b.run(cloud)]);
  const states = [(await a.quotes.get(original.id))!, (await b.quotes.get(original.id))!];
  expect(states.map(q => q.syncStatus).sort()).toEqual(["conflict", "synced"]);
  expect(states.find(q => q.syncStatus === "synced")?.notes).toBe(cloud.rows.get(original.id)?.notes);
  expect(states.find(q => q.syncStatus === "conflict")?.notes).not.toBe(cloud.rows.get(original.id)?.notes);
});

test("kolizja istniejącego UUID przy pierwszym połączeniu zachowuje obie różne treści", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  cloud.put({ ...quoteToCloud(original, workspaceId), notes: "Już istnieje w chmurze" });
  await d.run(cloud);
  expect(await d.quotes.get(original.id)).toMatchObject({ notes: original.notes, syncStatus: "conflict" });
  expect(cloud.writes).toBe(0);
});

test("wstrzymanie po wylogowaniu jest trwałe i nie blokuje lokalnej edycji", async () => {
  const d = await device(), cloud = new FakeCloud(), original = await quote(d);
  await d.run(cloud); await d.local.setPaused(true); d.db.close(); await d.db.open();
  await edit(d, original.id, "Bez logowania");
  await expect(d.run(cloud)).rejects.toThrow("wstrzymana");
  expect((await d.quotes.get(original.id))?.syncStatus).toBe("pending");
  expect(cloud.rows.get(original.id)?.notes).toBe("");
  await d.local.setPaused(false); await d.run(cloud);
  expect(cloud.rows.get(original.id)?.notes).toBe("Bez logowania");
});

test("nieudana migracja v4 wycofuje nowe tabele i zachowuje działającą bazę v3", async () => {
  const options = { indexedDB: new IDBFactory(), IDBKeyRange }, name = `rollback-${crypto.randomUUID()}`;
  const d = await device(), original = await quote(d), legacy = new Dexie(name, options);
  legacy.version(3).stores({ quotes: "&id, createdAt, updatedAt, syncStatus, completedAt", quotePhotos: "&id, quoteId, createdAt, updatedAt, syncStatus, deletedAt" });
  await legacy.table("quotes").add(original); legacy.close();
  const broken = new QuotesDatabase(name, options); databases.push(broken);
  broken.version(4).upgrade(() => { throw new Error("migration interrupted"); });
  await expect(Promise.resolve(broken.open())).rejects.toThrow("migration interrupted"); broken.close();
  await legacy.open();
  try {
    expect(legacy.verno).toBe(3); expect(await legacy.table("quotes").toArray()).toEqual([original]);
    expect(legacy.tables.map(table => table.name).sort()).toEqual(["quotePhotos", "quotes"]);
  } finally { legacy.close(); }
});
