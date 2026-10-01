import { nextChangeCursor } from "@/lib/supabase/cloud-repository";
import type { ChangeCursor } from "@/lib/supabase/cloud-repository";
import type { LocalSyncRepository } from "./local-sync-repository";
import type { QuoteSyncRemote } from "./types";

export class QuoteSyncEngine {
  constructor(private readonly local: LocalSyncRepository, private readonly remote: QuoteSyncRemote, private readonly projectUrl: string, private readonly checkActive: () => void = () => {}) {}

  async run() {
    const scope = { projectUrl: this.projectUrl, workspaceId: this.remote.workspaceId };
    this.checkActive();
    await this.local.assertBinding(scope.projectUrl, scope.workspaceId);
    await this.pull();
    for (const id of await this.local.pending()) {
      this.checkActive();
      // Recheck by ID: even an update that moved behind a page cursor must not be overwritten.
      const cloud = await this.remote.getQuote(id);
      this.checkActive();
      if (cloud) await this.local.applyCloud(cloud, scope);
      const state = await this.local.preparePush(id, scope);
      if (!state?.inFlight) continue;
      this.checkActive();
      const saved = await this.remote.saveQuoteConditionally(state.inFlight.row, state.base);
      this.checkActive();
      if (saved) await this.local.applyCloud(saved, scope);
      else {
        const newer = await this.remote.getQuote(id);
        this.checkActive();
        if (!newer) throw new Error("Chmura nie potwierdziła zapisu wyceny. Sprawdź członkostwo i dostęp; lokalne dane zachowano.");
        await this.local.applyCloud(newer, scope);
      }
    }
    await this.pull();
    this.checkActive();
    await this.local.finish(scope);
  }

  private async pull() {
    let cursor: ChangeCursor | undefined;
    // B1 deliberately starts each run at the beginning. A persisted high watermark can miss
    // a transaction committed late. Full keyset reconciliation suits a small workshop.
    for (let page = 0; page < 1000; page++) {
      this.checkActive();
      const rows = await this.remote.fetchChangedQuotes(cursor, 100);
      this.checkActive();
      for (const row of rows) {
        this.checkActive();
        await this.local.applyCloud(row, { projectUrl: this.projectUrl, workspaceId: this.remote.workspaceId });
      }
      if (rows.length < 100) return;
      const next = nextChangeCursor(rows);
      if (!next || (cursor && next.id === cursor.id && next.serverUpdatedAt === cursor.serverUpdatedAt)) throw new Error("Nie można kontynuować pobierania zmian. Spróbuj ponownie.");
      cursor = next;
    }
    throw new Error("Przekroczono limit stron synchronizacji. Dane lokalne zachowano.");
  }
}
