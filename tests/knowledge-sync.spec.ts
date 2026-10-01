import { expect, test } from "@playwright/test";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { LocalSyncRepository } from "../src/features/sync/local-sync-repository";
import { KnowledgeRepository } from "../src/features/knowledge/repository";
import { emptyKnowledgeDraft, type KnowledgeEntry } from "../src/features/knowledge/types";
import { LocalKnowledgeSync } from "../src/features/knowledge/sync/local";
import { KnowledgeSyncEngine } from "../src/features/knowledge/sync/engine";
import { toCloud } from "../src/features/knowledge/sync/mapping";
import { syncKey, type KnowledgeRemote, type KnowledgeTable } from "../src/features/knowledge/sync/types";
import type { CloudKnowledge, CloudKnowledgeWrite } from "../src/lib/supabase/database.types";
import type { ChangeCursor } from "../src/lib/supabase/cloud-repository";
import type { CloudVersion } from "../src/features/sync/types";
const workspaceId = "10000000-0000-4000-8000-000000000001", projectUrl = "https://isolated.invalid", scope = { projectUrl, workspaceId };
class Remote implements KnowledgeRemote {
  workspaceId = workspaceId;
  rows = { knowledge_categories: new Map<string, CloudKnowledge>(), knowledge_entries: new Map<string, CloudKnowledge>() };
  writes: KnowledgeTable[] = []; tick = 0; loseResponse = false; during?: () => Promise<void>;
  async fetch(table: KnowledgeTable, cursor?: ChangeCursor) {
    return structuredClone([...this.rows[table].values()].filter(row => !cursor || row.server_updated_at > cursor.serverUpdatedAt || row.server_updated_at === cursor.serverUpdatedAt && row.id > cursor.id)
      .sort((a,b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id)).slice(0,100));
  }
  async get(table: KnowledgeTable, id: string) { return structuredClone(this.rows[table].get(id) ?? null); }
  async save(table: KnowledgeTable, row: CloudKnowledgeWrite, base: CloudVersion | null) {
    const current = this.rows[table].get(row.id);
    if (base ? !current || base.revision !== current.revision || base.serverUpdatedAt !== current.server_updated_at : !!current) return null;
    if (table === "knowledge_entries") expect(this.rows.knowledge_categories.has((row.payload as KnowledgeEntry).categoryId)).toBe(true);
    const saved = { ...structuredClone(row), server_updated_at: new Date(Date.UTC(2026,8,7,0,0,++this.tick)).toISOString() };
    this.rows[table].set(row.id, saved); this.writes.push(table);
    await this.during?.(); this.during = undefined;
    if (this.loseResponse) { this.loseResponse = false; throw new Error("offline"); }
    return structuredClone(saved);
  }
}
const databases: QuotesDatabase[] = [];
async function device(factory = new IDBFactory(), name = crypto.randomUUID()) {
  const db = new QuotesDatabase(name, { indexedDB: factory, IDBKeyRange }); databases.push(db);
  const binding = new LocalSyncRepository(db); await binding.bind(projectUrl, { id: workspaceId, name: "Test" });
  const local = new LocalKnowledgeSync(db), repository = new KnowledgeRepository(db);
  return { db, local, repository, binding, run: (remote: Remote) => new KnowledgeSyncEngine(local, remote, projectUrl).run() };
}
test.afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function create(d: Awaited<ReturnType<typeof device>>, kind: "stone" | "product" = "stone") {
  const root = await d.repository.createCategory("Ręczna", null), sub = await d.repository.createCategory("Podkategoria", root.id);
  return d.repository.save({ ...emptyKnowledgeDraft("2020-02-29", kind), name: "Referencja", categoryId: root.id, subcategoryId: sub.id, carats: "0,375", unitNetPrice: "1000,50", notes: "ręcznie" });
}
test("dwa urządzenia: rodzice przed dziećmi, oba typy i brak importowania wycen", async () => {
  const a = await device(), b = await device(), remote = new Remote();
  const stone = await create(a); const product = await a.repository.save({ ...stone, kind: "product", name: "Bransoletka", finishedPrice: "1200" });
  expect((await a.local.summary()).pending).toHaveLength(4);
  await a.run(remote); await b.run(remote);
  expect(remote.writes).toEqual(["knowledge_categories", "knowledge_categories", "knowledge_entries", "knowledge_entries"]);
  expect((await b.repository.list()).entries.map(e => e.id).sort()).toEqual([stone.id, product.id].sort());
  expect((await a.local.summary()).pending).toHaveLength(0); expect((await b.local.summary()).pending).toHaveLength(0);
  expect(await b.db.quotes.count()).toBe(0); expect(await a.binding.finishFullSync(scope)).toBe(true);
});
test("offline restart: edycja, archiwum, przywrócenie i usunięcie docierają na drugie urządzenie", async () => {
  const factory = new IDBFactory(); let a = await device(factory, "offline"); const b = await device(), remote = new Remote();
  let entry = await create(a); await a.run(remote); await b.run(remote);
  entry = await a.repository.save({ ...entry, notes: "zmiana offline" }, entry);
  await a.repository.setArchived(entry.id, entry.revision, true); a.db.close(); a = await device(factory, "offline");
  await a.run(remote); await b.run(remote);
  expect(await b.db.knowledgeEntries.get(entry.id)).toMatchObject({ notes: "zmiana offline", archivedAt: expect.any(String) });
  entry = (await a.db.knowledgeEntries.get(entry.id))!; await a.repository.setArchived(entry.id, entry.revision, false);
  await a.run(remote); await b.run(remote); expect((await b.db.knowledgeEntries.get(entry.id))!.archivedAt).toBeNull();
  entry = (await a.db.knowledgeEntries.get(entry.id))!; await a.repository.remove(entry.id, entry.revision);
  expect(await a.db.knowledgeEntries.get(entry.id)).toBeUndefined(); expect((await a.local.summary()).pending).toHaveLength(1);
  a.db.close(); a = await device(factory, "offline"); await a.run(remote); await b.run(remote);
  expect(await b.db.knowledgeEntries.get(entry.id)).toBeUndefined(); expect(remote.rows.knowledge_entries.get(entry.id)!.deleted_at).toBeTruthy();
  expect((await a.local.summary()).pending).toHaveLength(0); await a.run(remote); expect(await a.db.knowledgeEntries.count()).toBe(0);
});
test("usunięcie przed pierwszym wysłaniem zachowuje trwały tombstone", async () => {
  const a = await device(), b = await device(), remote = new Remote(), entry = await create(a);
  await a.repository.remove(entry.id, entry.revision); await a.run(remote); await b.run(remote);
  expect(remote.rows.knowledge_entries.get(entry.id)!.deleted_at).toBeTruthy(); expect(await b.db.knowledgeEntries.count()).toBe(0);
});
test("utrata odpowiedzi po zapisie i nowa edycja w trakcie żądania nie gubią danych", async () => {
  const a = await device(), remote = new Remote(); let entry = await create(a); await a.run(remote);
  entry = await a.repository.save({ ...entry, notes: "pierwsza" }, entry);
  remote.during = async () => { entry = await a.repository.save({ ...entry, notes: "druga" }, entry); };
  remote.loseResponse = true; await expect(a.run(remote)).rejects.toThrow("offline");
  expect((await a.db.knowledgeSync.get(syncKey("knowledge_entries", entry.id)))!.inFlight).toBeTruthy();
  await a.run(remote); expect((remote.rows.knowledge_entries.get(entry.id)!.payload as KnowledgeEntry).notes).toBe("druga");
  expect((await a.local.summary()).pending).toHaveLength(0); expect((await a.local.summary()).conflicts).toHaveLength(0);
});
test("usunięcie podczas wysyłania tworzonego rekordu nie zostaje cofnięte", async () => {
  const a = await device(), remote = new Remote(); const entry = await create(a);
  // Send categories first; then delete exactly while the entry request is in flight.
  remote.during = async () => {};
  const save = remote.save.bind(remote);
  remote.save = async (table,row,base) => { if (table === "knowledge_entries" && !row.deleted_at) remote.during = () => a.repository.remove(entry.id, entry.revision); return save(table,row,base); };
  await a.run(remote); await a.run(remote);
  expect(await a.db.knowledgeEntries.count()).toBe(0); expect(remote.rows.knowledge_entries.get(entry.id)!.deleted_at).toBeTruthy();
});
for (const choice of ["local", "cloud"] as const) test(`konflikt edycji: jawny wybór ${choice}`, async () => {
  const a = await device(), b = await device(), remote = new Remote(); const entry = await create(a); await a.run(remote); await b.run(remote);
  await a.repository.save({ ...entry, notes: "A" }, entry);
  const eb = (await b.db.knowledgeEntries.get(entry.id))!; await b.repository.save({ ...eb, notes: "B" }, eb);
  await a.run(remote); await b.run(remote);
  const conflict = (await b.local.summary()).conflicts[0]; expect(conflict).toBeTruthy(); expect((await b.db.knowledgeEntries.get(entry.id))!.notes).toBe("B");
  expect(await b.binding.finishFullSync(scope)).toBe(false);
  await b.local.resolve(conflict.state, conflict.token, choice, scope); await b.run(remote); await a.run(remote);
  expect((await a.db.knowledgeEntries.get(entry.id))!.notes).toBe(choice === "local" ? "B" : "A");
});
test("konflikt usunięcia z edycją zachowuje obie wersje; nieaktualny wybór odrzucony", async () => {
  const a = await device(), b = await device(), remote = new Remote(); const entry = await create(a); await a.run(remote); await b.run(remote);
  await a.repository.remove(entry.id, entry.revision); const eb = (await b.db.knowledgeEntries.get(entry.id))!;
  const edited = await b.repository.save({ ...eb, notes: "B" }, eb); await a.run(remote); await b.run(remote);
  const conflict = (await b.local.summary()).conflicts[0]; expect(conflict.state.conflict!.deleted_at).toBeTruthy();
  await b.repository.save({ ...edited, notes: "B2" }, edited);
  await expect(b.local.resolve(conflict.state, conflict.token, "cloud", scope)).rejects.toThrow("Dane zmieniły się");
  const latest = (await b.local.summary()).conflicts[0]; await b.local.resolve(latest.state, latest.token, "local", scope);
  await b.run(remote); await a.run(remote); expect((await a.db.knowledgeEntries.get(entry.id))!.notes).toBe("B2");
});
test("obca pracownia, wstrzymanie sesji i błędny payload nie mutują lokalnej bazy", async () => {
  const a = await device(), remote = new Remote(), entry = await create(a); await a.run(remote);
  const row = remote.rows.knowledge_entries.get(entry.id)!;
  await expect(a.local.apply({ ...row, workspace_id: crypto.randomUUID() }, "knowledge_entries", scope)).rejects.toThrow("pracownia");
  await expect(a.local.apply({ ...row, payload: {} }, "knowledge_entries", scope)).rejects.toThrow("rekord");
  remote.workspaceId = crypto.randomUUID(); await expect(a.run(remote)).rejects.toThrow("inną pracownią");
  remote.workspaceId = workspaceId; await a.binding.setPaused(true); await expect(a.run(remote)).rejects.toThrow("wstrzymana");
  expect(await a.db.knowledgeEntries.get(entry.id)).toEqual(entry);
});
test("pełne stronicowanie, powtórzenia i spóźnione rekordy", async () => {
  const a = await device(), b = await device(), remote = new Remote(), entry = await create(a); await a.run(remote);
  for (let i=0;i<101;i++) { const row = { ...toCloud({ ...entry, id: crypto.randomUUID() }, workspaceId), server_updated_at: "2020-01-01T00:00:00Z" }; remote.rows.knowledge_entries.set(row.id, row); }
  await b.run(remote); expect(await b.db.knowledgeEntries.count()).toBe(102); const writes = remote.writes.length;
  await b.run(remote); expect(remote.writes).toHaveLength(writes); expect((await b.local.summary()).pending).toHaveLength(0);
});
test("migracja v7 do v8 nie zmienia wpisów ani powiązania; istniejące wpisy oczekują na wysłanie", async () => {
  const factory = new IDBFactory(), old = new Dexie("legacy7", { indexedDB: factory, IDBKeyRange });
  old.version(7).stores({ quotes: "&id", knowledgeCategories: "&id, parentId", knowledgeEntries: "&id, categoryId, subcategoryId, kind, updatedAt, archivedAt", syncSettings: "&key" });
  const category = { id: crypto.randomUUID(), name: "Istniejąca", parentId: null, createdAt: "2020-01-01T00:00:00Z" };
  await old.table("knowledgeCategories").add(category); await old.table("quotes").add({ id: "untouched", snapshot: { arbitrary: true } }); old.close();
  const a = await device(factory,"legacy7"); expect(a.db.verno).toBe(9); expect(await a.db.knowledgeCategories.get(category.id)).toEqual(category);
  expect(await a.db.quotes.get("untouched")).toEqual({ id: "untouched", snapshot: { arbitrary: true } }); expect((await a.local.summary()).pending).toHaveLength(1);
  await a.run(new Remote()); expect((await a.local.summary()).pending).toHaveLength(0);
});
