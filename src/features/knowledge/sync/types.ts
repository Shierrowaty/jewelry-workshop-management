import type { CloudKnowledge, CloudKnowledgeWrite } from "@/lib/supabase/database.types";
import type { ChangeCursor } from "@/lib/supabase/cloud-repository";
import type { CloudVersion } from "../../sync/types";
import type { KnowledgeEntry } from "../types";
export type KnowledgeTable = "knowledge_categories" | "knowledge_entries";
export type KnowledgeSyncState = {
  key: string; table: KnowledgeTable; id: string;
  base: CloudKnowledge | null; conflict: CloudKnowledge | null;
  inFlight: CloudKnowledgeWrite | null;
  deletedEntry: KnowledgeEntry | null;
};
export const syncKey = (table: KnowledgeTable, id: string) => `${table}:${id}`;
export const emptyState = (table: KnowledgeTable, id: string): KnowledgeSyncState => ({ key: syncKey(table, id), table, id, base: null, conflict: null, inFlight: null, deletedEntry: null });
export interface KnowledgeRemote {
  readonly workspaceId: string;
  fetch(table: KnowledgeTable, cursor?: ChangeCursor): Promise<CloudKnowledge[]>;
  get(table: KnowledgeTable, id: string): Promise<CloudKnowledge | null>;
  save(table: KnowledgeTable, row: CloudKnowledgeWrite, base: CloudVersion | null): Promise<CloudKnowledge | null>;
}
