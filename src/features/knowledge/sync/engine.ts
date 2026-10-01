import { nextChangeCursor, type ChangeCursor } from "@/lib/supabase/cloud-repository";
import { LocalKnowledgeSync } from "./local";
import type { KnowledgeRemote, KnowledgeTable } from "./types";
import { version } from "./mapping";
export class KnowledgeSyncEngine {
  constructor(private readonly local: LocalKnowledgeSync, private readonly remote: KnowledgeRemote, private readonly projectUrl: string, private readonly active: () => void = () => {}) {}
  private scope() { return { projectUrl: this.projectUrl, workspaceId: this.remote.workspaceId }; }
  async run() {
    this.active(); await this.local.assertScope(this.scope());
    await this.pull();
    for (const item of (await this.local.summary()).pending) {
      this.active();
      const cloud = await this.remote.get(item.table, item.id);
      this.active(); if (cloud) await this.local.apply(cloud, item.table, this.scope());
      const state = await this.local.prepare(item.table, item.id, this.scope());
      if (!state?.inFlight) continue;
      this.active();
      const saved = await this.remote.save(item.table, state.inFlight, state.base ? version(state.base) : null);
      this.active();
      const confirmed = saved ?? await this.remote.get(item.table, item.id);
      this.active();
      if (!confirmed) throw new Error("Chmura nie potwierdziła zapisu Bazy wiedzy. Dane lokalne zachowano.");
      await this.local.apply(confirmed, item.table, this.scope());
    }
    await this.pull();
  }
  private async pull() {
    for (const table of ["knowledge_categories", "knowledge_entries"] as KnowledgeTable[]) {
      let cursor: ChangeCursor | undefined;
      // Full keyset reconciliation also sees transactions that committed late.
      for (let page = 0; ; page++) {
        if (page === 1000) throw new Error("Przekroczono limit pobierania Bazy wiedzy.");
        this.active(); const rows = await this.remote.fetch(table, cursor); this.active();
        for (const row of rows) { this.active(); await this.local.apply(row, table, this.scope()); }
        if (rows.length < 100) break;
        const next = nextChangeCursor(rows);
        if (!next || next.id === cursor?.id && next.serverUpdatedAt === cursor.serverUpdatedAt) throw new Error("Nie można pobrać kolejnej strony Bazy wiedzy.");
        cursor = next;
      }
    }
  }
}
