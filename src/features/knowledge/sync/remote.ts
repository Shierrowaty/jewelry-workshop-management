import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudKnowledgeWrite, Database } from "@/lib/supabase/database.types";
import type { ChangeCursor } from "@/lib/supabase/cloud-repository";
import { requireUuid } from "@/lib/supabase/mappers";
import { timeMicros } from "../../sync/quote-validation";
import type { CloudVersion } from "../../sync/types";
import type { KnowledgeRemote, KnowledgeTable } from "./types";

export class SupabaseKnowledgeRepository implements KnowledgeRemote {
  readonly workspaceId: string;
  constructor(private readonly client: SupabaseClient<Database>, workspaceId: string) { this.workspaceId = requireUuid(workspaceId); }
  async fetch(table: KnowledgeTable, cursor?: ChangeCursor) {
    let query = this.client.from(table).select("id,workspace_id,created_at,updated_at,revision,schema_version,payload,deleted_at,server_updated_at")
      .eq("workspace_id", this.workspaceId).order("server_updated_at").order("id").limit(100);
    if (cursor) {
      timeMicros(cursor.serverUpdatedAt); requireUuid(cursor.id);
      query = query.or(`server_updated_at.gt.${cursor.serverUpdatedAt},and(server_updated_at.eq.${cursor.serverUpdatedAt},id.gt.${cursor.id})`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  async get(table: KnowledgeTable, id: string) {
    const { data, error } = await this.client.from(table).select().eq("workspace_id", this.workspaceId).eq("id", requireUuid(id)).maybeSingle();
    if (error) throw error;
    return data;
  }
  async save(table: KnowledgeTable, row: CloudKnowledgeWrite, base: CloudVersion | null) {
    requireUuid(row.id);
    if (row.workspace_id !== this.workspaceId || row.revision !== (base?.revision ?? 0) + 1) throw new Error("Niepoprawna pracownia lub rewizja Bazy wiedzy.");
    if (!base) {
      const { data, error } = await this.client.from(table).insert(row).select().single();
      if (error?.code === "23505") return null;
      if (error) throw error;
      return data;
    }
    timeMicros(base.serverUpdatedAt);
    const { data, error } = await this.client.from(table).update(row).eq("workspace_id", this.workspaceId).eq("id", row.id)
      .eq("revision", base.revision).eq("server_updated_at", base.serverUpdatedAt).select().maybeSingle();
    if (error) throw error;
    return data;
  }
}
