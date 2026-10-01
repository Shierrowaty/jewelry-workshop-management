import { LocalKnowledgeSync } from "../knowledge/sync/local";
import type { QuotesDatabase } from "../quotes/data/database";
import type { CloudQuote } from "@/lib/supabase/database.types";
import { quoteToCloud, requireUuid } from "@/lib/supabase/mappers";
import type { QuoteSyncState, SyncWorkspace, Workspace } from "./types";
import { cloudVersion, quoteFromCloud, sameCloudContent, sameVersion, timeMicros, validateCloudQuote } from "./quote-validation";

export class LocalSyncRepository {
  constructor(private readonly db: QuotesDatabase) {}

  binding() { return this.db.syncSettings.get("workspace"); }
  async bind(projectUrl: string, workspace: Workspace) {
    requireUuid(workspace.id);
    return this.db.transaction("rw", this.db.syncSettings, async () => {
      const existing = await this.binding();
      if (existing && (existing.projectUrl !== projectUrl || existing.workspaceId !== workspace.id)) {
        throw new Error("Ta lokalna baza jest już połączona z inną pracownią lub projektem. Użyj właściwego konta albo osobnego profilu przeglądarki. Dane nie zostały przeniesione.");
      }
      const setting: SyncWorkspace = { key: "workspace", projectUrl, workspaceId: workspace.id, workspaceName: workspace.name, lastSyncedAt: existing?.lastSyncedAt ?? null, lastSuccessfulSyncAt: existing?.lastSuccessfulSyncAt ?? null };
      await this.db.syncSettings.put(setting);
      return setting;
    });
  }

  async assertBinding(projectUrl: string, workspaceId: string) {
    const binding = await this.binding();
    if (!binding) throw new Error("Synchronizacja wymaga potwierdzonego powiązania tej bazy z właściwą pracownią.");
    if (binding.projectUrl !== projectUrl || binding.workspaceId !== workspaceId) throw new Error("Baza tego urządzenia jest powiązana z inną pracownią lub projektem. Zaloguj się do właściwego konta; do innej pracowni użyj osobnego profilu przeglądarki.");
    if (binding.syncPaused) throw new Error("Synchronizacja jest wstrzymana po wylogowaniu. Zaloguj się ponownie, aby ją wznowić.");
    return binding;
  }

  async setPaused(syncPaused: boolean) {
    await this.db.transaction("rw", this.db.syncSettings, async () => {
      const binding = await this.binding();
      if (binding) await this.db.syncSettings.put({ ...binding, syncPaused });
    });
  }

  async summary() {
    const [quotes, binding] = await Promise.all([this.db.quotes.toArray(), this.binding()]);
    const [pendingIds, states] = await Promise.all([
      this.db.quotePhotos.where("syncStatus").anyOf("pending", "local").primaryKeys(), this.db.photoSync.toArray(),
    ]);
    const photoConflicts = states.filter(state => state.phase === "conflict").map(state => ({ id: state.photoId, quoteId: state.quoteId, message: state.error }));
    const photoPending = new Set([...pendingIds, ...states.filter(state => !["done", "conflict"].includes(state.phase)).map(state => state.photoId)]).size;
    const knowledge = await new LocalKnowledgeSync(this.db).summary();
    return { knowledgePending: knowledge.pending.length, knowledgeConflicts: knowledge.conflicts.length, photoPending, photoConflicts, binding, total: quotes.length, pending: quotes.filter(q => q.syncStatus === "pending" || q.syncStatus === "local").length, conflicts: quotes.filter(q => q.syncStatus === "conflict").map(q => ({ id: q.id, name: q.snapshot.customer.name || "Bez nazwy klienta" })) };
  }
  conflict(id: string) { return this.db.quoteSync.get(id); }
  pending() { return this.db.quotes.where("syncStatus").anyOf("local", "pending").primaryKeys(); }

  async applyCloud(row: CloudQuote, scope: Pick<SyncWorkspace, "projectUrl" | "workspaceId">) {
    validateCloudQuote(row, scope.workspaceId);
    return this.db.transaction("rw", this.db.quotes, this.db.quoteSync, this.db.syncSettings, async () => {
      await this.assertBinding(scope.projectUrl, scope.workspaceId);
      const current = await this.db.quotes.get(row.id);
      const state: QuoteSyncState = await this.db.quoteSync.get(row.id) ?? { quoteId: row.id, base: null, conflict: null, inFlight: null };
      const version = cloudVersion(row);
      if (!current) {
        // B1 never physically deletes local quotes or their photos.
        if (row.deleted_at) return;
        await this.db.quotes.add(quoteFromCloud(row, scope.workspaceId));
        await this.db.quoteSync.put({ ...state, base: version, conflict: null, inFlight: null });
        return;
      }
      if (state.inFlight && sameCloudContent(state.inFlight.row, row)) {
        await this.db.quotes.put({ ...current, syncStatus: current.revision === state.inFlight.localRevision ? "synced" : "pending" });
        await this.db.quoteSync.put({ ...state, base: version, conflict: null, inFlight: null });
        return;
      }
      if (sameVersion(state.base, version)) return;
      // Ignore a repeated older page/response, never roll back an acknowledged cloud version.
      if (state.base && version.revision <= state.base.revision && timeMicros(version.serverUpdatedAt) < timeMicros(state.base.serverUpdatedAt)) return;
      const equivalent = !state.base && !row.deleted_at && current.syncStatus !== "conflict" && sameCloudContent({ ...quoteToCloud(current, scope.workspaceId), revision: row.revision }, row);
      if (!row.deleted_at && ((current.syncStatus === "synced" && state.base) || equivalent)) {
        await this.db.quotes.put(equivalent ? { ...current, syncStatus: "synced" } : quoteFromCloud(row, scope.workspaceId, current));
        await this.db.quoteSync.put({ ...state, base: version, conflict: null, inFlight: null });
        return;
      }
      // Keep BOTH versions. Local edits in conflict remain conflicts until an explicit decision.
      await this.db.quotes.put({ ...current, syncStatus: "conflict" });
      await this.db.quoteSync.put({ ...state, conflict: structuredClone(row), inFlight: null });
    });
  }

  async preparePush(id: string, scope: Pick<SyncWorkspace, "projectUrl" | "workspaceId">) {
    return this.db.transaction("rw", this.db.quotes, this.db.quoteSync, this.db.syncSettings, async () => {
      await this.assertBinding(scope.projectUrl, scope.workspaceId);
      const quote = await this.db.quotes.get(id);
      if (!quote || !["pending", "local"].includes(quote.syncStatus)) return null;
      const state: QuoteSyncState = await this.db.quoteSync.get(id) ?? { quoteId: id, base: null, conflict: null, inFlight: null };
      if (state.conflict) return null;
      if (!state.inFlight) {
        const row = { ...quoteToCloud(quote, scope.workspaceId), revision: (state.base?.revision ?? 0) + 1 };
        state.inFlight = { row, localRevision: quote.revision };
        await this.db.quoteSync.put(state);
      }
      return state;
    });
  }

  async resolve(id: string, expectedRevision: number, expectedCloud: CloudQuote, choice: "local" | "cloud", scope: Pick<SyncWorkspace, "projectUrl" | "workspaceId">) {
    return this.db.transaction("rw", this.db.quotes, this.db.quoteSync, this.db.syncSettings, async () => {
      await this.assertBinding(scope.projectUrl, scope.workspaceId);
      const quote = await this.db.quotes.get(id);
      const state = await this.db.quoteSync.get(id);
      if (!quote || !state?.conflict || quote.revision !== expectedRevision || !sameVersion(cloudVersion(state.conflict), cloudVersion(expectedCloud))) {
        throw new Error("Dane zmieniły się od otwarcia potwierdzenia. Sprawdź aktualne wersje i spróbuj ponownie.");
      }
      if (state.conflict.deleted_at) throw new Error("Wycena została oznaczona jako usunięta w chmurze. B1 nie obsługuje usuwania ani przywracania takich rekordów; lokalną wycenę i zdjęcia zachowano.");
      await this.db.quotes.put(choice === "cloud" ? quoteFromCloud(state.conflict, scope.workspaceId, quote) : { ...quote, revision: quote.revision + 1, syncStatus: "pending" });
      await this.db.quoteSync.put({ ...state, base: cloudVersion(state.conflict), conflict: null, inFlight: null });
    });
  }

  async finishFullSync(scope: Pick<SyncWorkspace, "projectUrl" | "workspaceId">) {
    return this.db.transaction("rw", [this.db.syncSettings, this.db.quotes, this.db.quotePhotos, this.db.photoSync, this.db.knowledgeCategories, this.db.knowledgeEntries, this.db.knowledgeSync], async () => {
      const binding = await this.assertBinding(scope.projectUrl, scope.workspaceId);
      const summary = await this.summary();
      if (summary.knowledgePending || summary.knowledgeConflicts || summary.pending || summary.photoPending || summary.conflicts.length || summary.photoConflicts.length) return false;
      await this.db.syncSettings.put({ ...binding, lastSuccessfulSyncAt: new Date().toISOString() });
      return true;
    });
  }

  async finish(scope: Pick<SyncWorkspace, "projectUrl" | "workspaceId">) {
    await this.db.transaction("rw", this.db.syncSettings, async () => {
      const binding = await this.assertBinding(scope.projectUrl, scope.workspaceId);
      await this.db.syncSettings.put({ ...binding, lastSyncedAt: new Date().toISOString() });
    });
  }
}
