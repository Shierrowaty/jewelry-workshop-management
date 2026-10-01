import type { CloudKnowledge, CloudKnowledgeWrite, Json } from "@/lib/supabase/database.types";
import { requireUuid } from "@/lib/supabase/mappers";
import { timeMicros } from "../../sync/quote-validation";
import { emptyKnowledgeDraft, type KnowledgeCategory, type KnowledgeDraft, type KnowledgeEntry } from "../types";
import { calculateKnowledge } from "../calculations";
import type { KnowledgeTable } from "./types";
export const version = (row: CloudKnowledge) => ({ revision: row.revision, serverUpdatedAt: row.server_updated_at });
export function toCloud(item: KnowledgeCategory | KnowledgeEntry, workspaceId: string, deleted = false): CloudKnowledgeWrite {
  const payload: Record<string, Json> = { ...item };
  delete payload.id; delete payload.revision; delete payload.createdAt; delete payload.updatedAt;
  return { id: item.id, workspace_id: workspaceId, created_at: item.createdAt, updated_at: item.updatedAt ?? item.createdAt,
    schema_version: 1, revision: 1, payload, deleted_at: deleted ? item.updatedAt ?? item.createdAt : null };
}
function canonical(value: Json): string {
  if (value && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(Object.keys(value).sort().map(key => [key, canonical(value[key] ?? null)]));
  return JSON.stringify(value);
}
// Local revisions are device-specific; compare the actual persisted content, not counters.
export function fingerprint(row: CloudKnowledgeWrite | null) {
  return row ? canonical({ id: row.id, workspace: row.workspace_id, created: new Date(row.created_at).toISOString(), updated: new Date(row.updated_at).toISOString(), deleted: row.deleted_at ? new Date(row.deleted_at).toISOString() : null, payload: row.payload }) : "absent";
}
export function validate(row: CloudKnowledge, table: KnowledgeTable, workspaceId: string) {
  requireUuid(row.id); requireUuid(row.workspace_id);
  if (row.workspace_id !== workspaceId || row.schema_version !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Nieobsługiwana wersja lub pracownia Bazy wiedzy. Dane lokalne zachowano.");
  for (const time of [row.created_at, row.updated_at, row.server_updated_at, ...(row.deleted_at ? [row.deleted_at] : [])]) timeMicros(time);
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.name !== "string" || !payload.name.trim()) throw new Error("Niepoprawny rekord Bazy wiedzy.");
  if (table === "knowledge_categories") {
    if (row.deleted_at || !(payload.parentId === null || typeof payload.parentId === "string")) throw new Error("Niepoprawna kategoria Bazy wiedzy.");
    if (payload.parentId) requireUuid(payload.parentId);
  } else {
    if (!Object.keys(emptyKnowledgeDraft("")).every(key => typeof payload[key] === "string") || !(payload.archivedAt === null || typeof payload.archivedAt === "string")) throw new Error("Niepełny rekord Bazy wiedzy.");
    requireUuid(String(payload.categoryId)); if (payload.subcategoryId) requireUuid(String(payload.subcategoryId));
    if (payload.archivedAt) timeMicros(String(payload.archivedAt));
    if (Object.keys(calculateKnowledge(payload as unknown as KnowledgeDraft).errors).length) throw new Error("Niepoprawne pola rekordu Bazy wiedzy.");
  }
}
export function fromCategory(row: CloudKnowledge): KnowledgeCategory {
  const payload = row.payload as { name: string; parentId: string | null };
  return { name: payload.name, parentId: payload.parentId, id: row.id, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), revision: row.revision };
}
export function fromEntry(row: CloudKnowledge, previous?: KnowledgeEntry): KnowledgeEntry {
  const payload = row.payload as unknown as KnowledgeDraft & { archivedAt: string | null };
  return { ...payload, id: row.id, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), revision: Math.max(row.revision, (previous?.revision ?? 0) + 1) };
}
