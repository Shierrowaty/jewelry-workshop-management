import type { CloudKnowledge, CloudKnowledgeWrite } from "@/lib/supabase/database.types";
import type { QuotesDatabase } from "../../quotes/data/database";
import { LocalSyncRepository } from "../../sync/local-sync-repository";
import { sameVersion, timeMicros } from "../../sync/quote-validation";
import type { SyncWorkspace } from "../../sync/types";
import { emptyState, syncKey, type KnowledgeSyncState, type KnowledgeTable } from "./types";
import { fingerprint, fromCategory, fromEntry, toCloud, validate, version } from "./mapping";
type Scope = Pick<SyncWorkspace, "projectUrl" | "workspaceId">;

export class LocalKnowledgeSync {
  constructor(private readonly db: QuotesDatabase) {}
  private tables() { return [this.db.knowledgeCategories, this.db.knowledgeEntries, this.db.knowledgeSync, this.db.syncSettings]; }
  async assertScope(scope: Scope) { await new LocalSyncRepository(this.db).assertBinding(scope.projectUrl, scope.workspaceId); }
  private state(table: KnowledgeTable, id: string) { return this.db.knowledgeSync.get(syncKey(table, id)).then(state => state ?? emptyState(table, id)); }
  async current(state: KnowledgeSyncState, workspaceId: string): Promise<CloudKnowledgeWrite | null> {
    const item = state.table === "knowledge_categories" ? await this.db.knowledgeCategories.get(state.id) : await this.db.knowledgeEntries.get(state.id);
    return item ? toCloud(item, workspaceId) : state.deletedEntry ? toCloud(state.deletedEntry, workspaceId, true) : null;
  }
  async summary() {
    return this.db.transaction("r", this.tables(), async () => {
      const workspaceId = (await this.db.syncSettings.get("workspace"))?.workspaceId ?? "";
      const states = new Map((await this.db.knowledgeSync.toArray()).map(state => [state.key, state]));
      for (const table of ["knowledge_categories", "knowledge_entries"] as const) {
        const ids = await (table === "knowledge_categories" ? this.db.knowledgeCategories : this.db.knowledgeEntries).toCollection().primaryKeys();
        for (const id of ids) if (!states.has(syncKey(table, id))) states.set(syncKey(table, id), emptyState(table, id));
      }
      const pending: KnowledgeSyncState[] = [], conflicts: { state: KnowledgeSyncState; local: CloudKnowledgeWrite | null; token: string }[] = [];
      for (const state of states.values()) {
        const current = await this.current(state, workspaceId);
        if (state.conflict) conflicts.push({ state, local: current, token: fingerprint(current) });
        else if (state.inFlight || current && fingerprint(current) !== fingerprint(state.base)) pending.push(state);
      }
      // Parent categories must be uploaded before subcategories, then entries.
      const roots = new Set((await this.db.knowledgeCategories.toArray()).filter(item => !item.parentId).map(item => item.id));
      const rank = (state: KnowledgeSyncState) => state.table === "knowledge_entries" ? 2 : roots.has(state.id) ? 0 : 1;
      pending.sort((a, b) => rank(a) - rank(b));
      return { pending, conflicts };
    });
  }
  private async install(row: CloudKnowledge, state: KnowledgeSyncState) {
    if (state.table === "knowledge_categories") await this.db.knowledgeCategories.put(fromCategory(row));
    else if (row.deleted_at) await this.db.knowledgeEntries.delete(row.id);
    else await this.db.knowledgeEntries.put(fromEntry(row, await this.db.knowledgeEntries.get(row.id)));
    await this.db.knowledgeSync.put({ ...state, base: row, conflict: null, inFlight: null, deletedEntry: null });
  }
  async apply(row: CloudKnowledge, table: KnowledgeTable, scope: Scope) {
    validate(row, table, scope.workspaceId);
    await this.db.transaction("rw", this.tables(), async () => {
      await this.assertScope(scope);
      const state = await this.state(table, row.id), current = await this.current(state, scope.workspaceId);
      if (state.inFlight && fingerprint(state.inFlight) === fingerprint(row) && state.inFlight.revision === row.revision) {
        // Lost responses and writes made during a request: acknowledge only what was sent.
        if (fingerprint(current) === fingerprint(row)) await this.db.knowledgeSync.put({ ...state, base: row, conflict: null, inFlight: null, deletedEntry: null });
        else await this.db.knowledgeSync.put({ ...state, base: row, conflict: null, inFlight: null });
        return;
      }
      if (state.conflict && sameVersion(version(state.conflict), version(row))) return;
      if (state.base && sameVersion(version(state.base), version(row))) return;
      if (state.base && row.revision <= state.base.revision && timeMicros(row.server_updated_at) < timeMicros(state.base.server_updated_at)) return;
      if (!state.conflict && (!current || fingerprint(current) === fingerprint(state.base) || fingerprint(current) === fingerprint(row))) {
        await this.install(row, state); return;
      }
      await this.db.knowledgeSync.put({ ...state, conflict: row, inFlight: null });
    });
  }
  async prepare(table: KnowledgeTable, id: string, scope: Scope) {
    return this.db.transaction("rw", this.tables(), async () => {
      await this.assertScope(scope);
      const state = await this.state(table, id), current = await this.current(state, scope.workspaceId);
      if (state.conflict || !current || !state.inFlight && fingerprint(current) === fingerprint(state.base)) return null;
      if (!state.inFlight) { state.inFlight = { ...current, revision: (state.base?.revision ?? 0) + 1 }; await this.db.knowledgeSync.put(state); }
      return state;
    });
  }
  async resolve(expected: KnowledgeSyncState, token: string, choice: "local" | "cloud", scope: Scope) {
    await this.db.transaction("rw", this.tables(), async () => {
      await this.assertScope(scope);
      const state = await this.state(expected.table, expected.id);
      if (!state.conflict || !expected.conflict || !sameVersion(version(state.conflict), version(expected.conflict)) || fingerprint(await this.current(state, scope.workspaceId)) !== token) throw new Error("Dane zmieniły się. Sprawdź aktualne wersje przed wyborem.");
      if (choice === "cloud") await this.install(state.conflict, state);
      else await this.db.knowledgeSync.put({ ...state, base: state.conflict, conflict: null, inFlight: null });
    });
  }
}
