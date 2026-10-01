import { LocalKnowledgeSync } from "../knowledge/sync/local";
import { KnowledgeSyncEngine } from "../knowledge/sync/engine";
import { SupabaseKnowledgeRepository } from "../knowledge/sync/remote";
import { logsFor } from "../diagnostics/logs";
import { liveQuery } from "dexie";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database, CloudQuote } from "@/lib/supabase/database.types";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { getUser, signIn, signOut } from "@/lib/supabase/auth";
import { getUserWorkspace } from "@/lib/supabase/workspace";
import { SupabaseQuoteRepository } from "@/lib/supabase/cloud-repository";
import { getLocalDatabase } from "../quotes/data/database";
import { LocalSyncRepository } from "./local-sync-repository";
import { QuoteSyncEngine } from "./sync-engine";
import { LocalPhotoSyncRepository } from "./photos/local-photo-sync-repository";
import { PhotoSyncEngine } from "./photos/photo-sync-engine";
import type { Workspace } from "./types";

export type SyncView = {
  ready: boolean; online: boolean; busy: boolean;
  user: { id: string; email: string } | null;
  workspace: Workspace | null;
  message: string | null;
  summary: Awaited<ReturnType<LocalSyncRepository["summary"]>> | null;
};
const initial: SyncView = { ready: false, online: true, busy: false, user: null, workspace: null, message: null, summary: null };

export function syncLabel(view: SyncView) {
  if (!view.online) return "Brak internetu";
  if (view.busy) return "Synchronizacja…";
  if (view.summary?.knowledgeConflicts || view.summary?.conflicts.length || view.summary?.photoConflicts.length) return "Konflikt";
  if (view.message) return "Błąd";
  if (((view.summary?.pending ?? 0) + (view.summary?.photoPending ?? 0) + (view.summary?.knowledgePending ?? 0) > 0)) return "Oczekujące dane";
  if (view.user && view.workspace && view.summary?.binding?.lastSuccessfulSyncAt && !view.summary.binding.syncPaused && !view.summary.knowledgePending && !view.summary.knowledgeConflicts && !view.summary.pending && !view.summary.photoPending && !view.message) return "Zsynchronizowano";
  return "Lokalnie";
}

function errorMessage(error: unknown) {
  if (error instanceof Error && !/fetch|network|abort|timeout/i.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && error.code === "42501") return "Brak uprawnień do synchronizacji. Sprawdź konto i członkostwo w pracowni. Dane lokalne zachowano.";
  return "Nie udało się połączyć z Supabase. Dane pozostają lokalne; spróbuj ponownie po odzyskaniu połączenia.";
}

// UI-independent lifecycle. No passwords/tokens are copied into Dexie, messages or logs.
export class SyncController {
  private view = initial;
  private listeners = new Set<() => void>();
  private client?: SupabaseClient<Database>;
  private local?: LocalSyncRepository;
  private session: Session | null = null;
  private generation = 0;
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  private rerun = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.view;
  serverSnapshot = () => initial;
  private publish(patch: Partial<SyncView>) { this.view = { ...this.view, ...patch }; this.listeners.forEach(listener => listener()); }

  start() {
    this.started = true;
    this.publish({ online: navigator.onLine });
    this.local = new LocalSyncRepository(getLocalDatabase());
    const logs = logsFor(getLocalDatabase());
    const seenConflicts = new Set<string>();
    const unexpected = () => { void logs.record("runtime"); };
    window.addEventListener("error", unexpected);
    window.addEventListener("unhandledrejection", unexpected);
    const localChanges = liveQuery(() => this.local!.summary()).subscribe({
      next: summary => {
        this.publish({ summary });
        const ids = [...summary.conflicts.map(q => q.id), ...summary.photoConflicts.map(p => p.id)];
        for (const id of ids) if (!seenConflicts.has(id)) { seenConflicts.add(id); void logs.record("conflict"); }
        for (const id of seenConflicts) if (!ids.includes(id)) seenConflicts.delete(id);
      },
      error: error => { void logs.record("database", error); this.publish({ message: "Nie można odczytać stanu synchronizacji z lokalnej bazy." }); },
    });
    // Observe committed local changes across tabs, including durable deletion markers.
    const db = getLocalDatabase();
    const knowledgeChanges = liveQuery(async () => ({
      categories: await db.knowledgeCategories.toArray(), entries: await db.knowledgeEntries.toArray(),
      deletions: (await db.knowledgeSync.toArray()).filter(state => state.deletedEntry).map(state => state.deletedEntry),
    })).subscribe({ next: () => this.schedule(), error: error => { void logs.record("database", error); } });
    const refresh = setInterval(() => { if (this.session && navigator.onLine && !this.view.busy) this.schedule(); }, 30_000);
    let unsubscribeAuth: (() => void) | undefined;
    try {
      this.client = createBrowserSupabaseClient();
      const { data } = this.client.auth.onAuthStateChange((event, session) => {
        const changed = session?.user.id !== this.session?.user.id;
        if (changed || event === "SIGNED_OUT") this.generation++;
        this.session = session;
        this.publish({ ready: true, user: session ? { id: session.user.id, email: session.user.email ?? "" } : null, ...(changed || !session ? { workspace: null } : {}) });
        // Leave the Auth callback before running more Auth/DB operations.
        if (session && (changed || event === "INITIAL_SESSION")) this.schedule();
      });
      unsubscribeAuth = () => data.subscription.unsubscribe();
      void this.client.auth.getSession().then(({ error }) => {
        if (this.started && error) { void logs.record("auth", error); this.publish({ ready: true, message: errorMessage(error) }); }
      }).catch(error => { void logs.record("auth", error); if (this.started) this.publish({ ready: true, message: errorMessage(error) }); });
    } catch (error) { void logs.record("auth", error); this.publish({ ready: true, message: errorMessage(error) }); }
    const online = () => { this.publish({ online: true }); this.schedule(); };
    const offline = () => { this.generation++; this.publish({ online: false }); };
    const saved = () => this.schedule();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("quotes:saved-locally", saved);
    return () => {
      this.started = false; this.generation++; clearTimeout(this.timer);
      unsubscribeAuth?.(); localChanges.unsubscribe(); knowledgeChanges.unsubscribe(); clearInterval(refresh);
      window.removeEventListener("error", unexpected); window.removeEventListener("unhandledrejection", unexpected);
      window.removeEventListener("online", online); window.removeEventListener("offline", offline); window.removeEventListener("quotes:saved-locally", saved);
    };
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.started) void this.synchronize(); }, 700);
  }

  async login(email: string, password: string) {
    const client = this.client ?? createBrowserSupabaseClient();
    if (!navigator.onLine) throw new Error("Logowanie wymaga internetu. Możesz dalej korzystać z lokalnych wycen.");
    try { await signIn(client, email, password); }
    catch (error) { void logsFor(getLocalDatabase()).record("auth", error); throw new Error("Nie udało się zalogować. Sprawdź e-mail, hasło oraz połączenie z internetem."); }
    await this.local?.setPaused(false);
    await this.synchronize();
  }
  async logout() {
    this.generation++; clearTimeout(this.timer); this.rerun = false;
    try { await this.local?.setPaused(true); } catch (error) { void logsFor(getLocalDatabase()).record("database", error); throw error; }
    this.publish({ workspace: null, message: null });
    try { if (this.client) await signOut(this.client); }
    catch (error) { void logsFor(getLocalDatabase()).record("auth", error); this.publish({ message: "Nie udało się potwierdzić wylogowania w Supabase. Synchronizacja została wstrzymana. Spróbuj ponownie online." }); }
    // The SDK owns session removal. Never clear IndexedDB on logout.
  }

  async connect() {
    if (!this.client || !this.local) return;
    const epoch = this.generation;
    const user = await getUser(this.client);
    if (!user) throw new Error("Zaloguj się przed połączeniem pracowni.");
    const workspace = await getUserWorkspace(this.client, user.id);
    if (epoch !== this.generation || user.id !== this.session?.user.id) throw new Error("Sesja zmieniła się. Spróbuj ponownie.");
    await this.local.bind(getSupabaseConfig().url, workspace);
    await this.synchronize();
  }

  async synchronize() {
    if (!this.started || !this.client || !this.local || !navigator.onLine) return;
    if (this.view.busy) { this.rerun = true; return; }
    this.publish({ busy: true, message: null });
    let success = false;
    const epoch = this.generation;
    const active = () => {
      if (!this.started || epoch !== this.generation || !navigator.onLine) throw new Error("Synchronizacja została przerwana. Dane lokalne zachowano.");
    };
    try {
      const { data, error } = await this.client.auth.getSession();
      active();
      if (error) throw error;
      if (!data.session) return;
      const user = await getUser(this.client);
      active();
      if (!user || user.id !== data.session.user.id) throw new Error("Zaloguj się ponownie, aby zsynchronizować wyceny.");
      const workspace = await getUserWorkspace(this.client, user.id);
      active();
      this.publish({ workspace });
      const binding = await this.local.binding();
      if (!binding) return; // First upload requires the visible, explicit workspace connection.
      const projectUrl = getSupabaseConfig().url;
      await this.local.assertBinding(projectUrl, workspace.id);
      if (!navigator.locks) throw new Error("Przeglądarka nie obsługuje bezpiecznej blokady synchronizacji. Zaktualizuj ją; lokalna praca jest dostępna.");
      const remote = new SupabaseQuoteRepository(this.client!, workspace.id);
      let quotesFinished = false;
      const syncQuotes = () => navigator.locks.request("jwm-quotes-sync", { ifAvailable: true }, async lock => {
        active();
        if (!lock) { this.publish({ message: "Synchronizacja trwa w innej karcie. Po jej zakończeniu możesz ponowić." }); return; }
        await new QuoteSyncEngine(this.local!, remote, projectUrl, active).run();
        active(); quotesFinished = true;
      });
      await syncQuotes();
      if (!quotesFinished) return;
      await navigator.locks.request("jwm-photos-sync", { ifAvailable: true }, async lock => {
        active();
        if (!lock) { this.publish({ message: "Zdjęcia synchronizują się w innej karcie. Możesz ponowić później." }); return; }
        const photos = new LocalPhotoSyncRepository(getLocalDatabase(), { projectUrl, workspaceId: workspace.id });
        await new PhotoSyncEngine(photos, remote, active, async () => {
          if (this.rerun) { this.rerun = false; await syncQuotes(); }
        }).run();
        active();
        let knowledgeFinished = false;
        await navigator.locks.request("jwm-knowledge-sync", { ifAvailable: true }, async lock => {
          active();
          if (!lock) { this.publish({ message: "Baza wiedzy synchronizuje się w innej karcie. Próba zostanie ponowiona." }); return; }
          await new KnowledgeSyncEngine(new LocalKnowledgeSync(getLocalDatabase()), new SupabaseKnowledgeRepository(this.client!, workspace.id), projectUrl, active).run();
          active(); knowledgeFinished = true;
        });
        if (!knowledgeFinished) return;
        await this.local!.finishFullSync({ projectUrl, workspaceId: workspace.id });
        active(); success = true;
      });
    } catch (error) { if (this.started) { void logsFor(getLocalDatabase()).record("sync", error); this.publish({ message: errorMessage(error) }); } }
    finally {
      if (this.started) this.publish({ busy: false });
      const repeat = this.rerun; this.rerun = false;
      if (repeat && success) this.schedule(); // Retry a save made during this run, never loop on errors.
    }
  }

  async resolve(id: string, revision: number, cloud: CloudQuote, choice: "local" | "cloud") {
    const binding = await this.local?.binding();
    if (!binding || !this.local || !navigator.locks) throw new Error("Nie można odczytać powiązania pracowni.");
    await navigator.locks.request("jwm-quotes-sync", async () => {
      await this.local!.resolve(id, revision, cloud, choice, binding);
    });
    this.schedule();
  }
}
