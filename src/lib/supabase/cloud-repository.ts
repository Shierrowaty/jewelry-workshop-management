import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudPhotoWrite, CloudQuoteWrite, Database } from "./database.types";
import { photoStoragePath, QUOTE_PHOTOS_BUCKET, requireUuid } from "./mappers";

export type ChangeCursor = { serverUpdatedAt: string; id: string };
type Deletion = { updatedAt: string; revision: number };

function timestamp(value: string) {
  // Keep Postgres microseconds; reject filter syntax instead of interpolating unchecked input.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("Niepoprawny znacznik czasu dla operacji chmurowej.");
  }
  return value;
}

function pageFilter(cursor: ChangeCursor | undefined, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Rozmiar strony musi wynosić od 1 do 500.");
  if (!cursor) return undefined;
  const time = timestamp(cursor.serverUpdatedAt);
  const id = requireUuid(cursor.id);
  return `server_updated_at.gt.${time},and(server_updated_at.eq.${time},id.gt.${id})`;
}

function deletionPatch(change: Deletion) {
  if (!Number.isInteger(change.revision) || change.revision < 1) throw new Error("Wymagana jest dodatnia rewizja rekordu.");
  return { updated_at: timestamp(change.updatedAt), deleted_at: change.updatedAt, revision: change.revision };
}

export function nextChangeCursor(rows: { server_updated_at: string; id: string }[]): ChangeCursor | undefined {
  const last = rows.at(-1);
  return last ? { serverUpdatedAt: last.server_updated_at, id: last.id } : undefined;
}

// Dormant transport adapter: injected client, one explicit workspace, no Dexie or background jobs.
// Upsert is NOT conflict resolution. A future synchronizer must decide which revision may be sent.
export class SupabaseQuoteRepository {
  readonly workspaceId: string;
  constructor(private readonly client: SupabaseClient<Database>, workspaceId: string) {
    this.workspaceId = requireUuid(workspaceId);
  }

  private assertWorkspace(workspaceId: string) {
    if (requireUuid(workspaceId) !== this.workspaceId) throw new Error("Rekord należy do innego workspace.");
  }

  async upsertQuote(quote: CloudQuoteWrite) {
    this.assertWorkspace(quote.workspace_id);
    requireUuid(quote.id);
    const { data, error } = await this.client.from("quotes").upsert(quote, { onConflict: "id" }).select().single();
    if (error) throw error;
    return data;
  }

  async fetchChangedQuotes(cursor?: ChangeCursor, limit = 100) {
    const filter = pageFilter(cursor, limit);
    let query = this.client.from("quotes").select().eq("workspace_id", this.workspaceId)
      .order("server_updated_at").order("id").limit(limit);
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw error;
    return data; // Includes tombstones; do not filter deleted_at from a synchronization feed.
  }

  async getQuote(id: string) {
    const { data, error } = await this.client.from("quotes").select()
      .eq("workspace_id", this.workspaceId).eq("id", requireUuid(id)).maybeSingle();
    if (error) throw error;
    return data;
  }

  async saveQuoteConditionally(quote: CloudQuoteWrite, base: { revision: number; serverUpdatedAt: string } | null) {
    this.assertWorkspace(quote.workspace_id);
    requireUuid(quote.id);
    if (!base) {
      const { data, error } = await this.client.from("quotes").insert(quote).select().single();
      if (error?.code === "23505") return null; // UUID already exists: reconcile, never upsert blindly.
      if (error) throw error;
      return data;
    }
    if (!Number.isSafeInteger(base.revision) || base.revision < 1 || quote.revision !== base.revision + 1) throw new Error("Niepoprawna rewizja zapisu do chmury.");
    const { data, error } = await this.client.from("quotes").update(quote)
      .eq("workspace_id", this.workspaceId).eq("id", quote.id)
      .eq("revision", base.revision).eq("server_updated_at", timestamp(base.serverUpdatedAt))
      .select().maybeSingle();
    if (error) throw error;
    return data; // Atomic UPDATE ... WHERE revision AND server_updated_at, under the existing RLS.
  }

  async upsertPhotoMetadata(photo: CloudPhotoWrite) {
    this.assertPhoto(photo);
    const { data, error } = await this.client.from("quote_photos").upsert(photo, { onConflict: "id" }).select().single();
    if (error) throw error;
    return data;
  }

  async getPhotoMetadata(id: string) {
    const { data, error } = await this.client.from("quote_photos").select()
      .eq("workspace_id", this.workspaceId).eq("id", requireUuid(id)).maybeSingle();
    if (error) throw error;
    return data;
  }

  async savePhotoConditionally(photo: CloudPhotoWrite, base: { revision: number; serverUpdatedAt: string } | null) {
    this.assertPhoto(photo);
    if (!base) {
      const { data, error } = await this.client.from("quote_photos").insert(photo).select().single();
      if (error?.code === "23505") return null;
      if (error) throw error;
      return data;
    }
    if (!Number.isSafeInteger(base.revision) || base.revision < 1 || photo.revision !== base.revision + 1) throw new Error("Niepoprawna rewizja zdjęcia.");
    const { data, error } = await this.client.from("quote_photos").update(photo)
      .eq("workspace_id", this.workspaceId).eq("id", photo.id)
      .eq("revision", base.revision).eq("server_updated_at", timestamp(base.serverUpdatedAt))
      .select().maybeSingle();
    if (error) throw error;
    return data;
  }

  async fetchChangedPhotoMetadata(cursor?: ChangeCursor, limit = 100) {
    const filter = pageFilter(cursor, limit);
    let query = this.client.from("quote_photos").select().eq("workspace_id", this.workspaceId)
      .order("server_updated_at").order("id").limit(limit);
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async softDeleteQuote(id: string, change: Deletion) {
    const { data, error } = await this.client.from("quotes").update(deletionPatch(change))
      .eq("workspace_id", this.workspaceId).eq("id", requireUuid(id)).select().single();
    if (error) throw error;
    return data;
  }

  async softDeletePhotoMetadata(id: string, change: Deletion) {
    const { data, error } = await this.client.from("quote_photos").update(deletionPatch(change))
      .eq("workspace_id", this.workspaceId).eq("id", requireUuid(id)).select().single();
    if (error) throw error;
    return data;
  }

  private assertPhoto(photo: CloudPhotoWrite) {
    this.assertWorkspace(photo.workspace_id);
    if (photo.storage_path !== photoStoragePath(this.workspaceId, photo.quote_id, photo.id, photo.mime_type)) {
      throw new Error("Ścieżka Storage nie odpowiada identyfikatorom zdjęcia.");
    }
  }

  async uploadPhoto(photo: CloudPhotoWrite, blob: Blob) {
    this.assertPhoto(photo);
    if (photo.deleted_at || blob.type !== photo.mime_type || blob.size !== photo.size || blob.size < 1 || blob.size > 2097152) {
      throw new Error("Plik nie odpowiada aktywnym metadanym zdjęcia lub przekracza 2 MiB.");
    }
    const { data, error } = await this.client.storage.from(QUOTE_PHOTOS_BUCKET).upload(photo.storage_path, blob, {
      contentType: photo.mime_type, upsert: false, cacheControl: "0",
    });
    if (error) throw error;
    return data;
  }

  async downloadPhoto(photo: CloudPhotoWrite) {
    this.assertPhoto(photo);
    if (photo.deleted_at) throw new Error("Zdjęcie jest oznaczone jako usunięte.");
    const { data, error } = await this.client.storage.from(QUOTE_PHOTOS_BUCKET).download(photo.storage_path);
    if (error) throw error;
    return data;
  }

  async removePhotoFile(photo: CloudPhotoWrite) {
    this.assertPhoto(photo);
    const { data, error } = await this.client.storage.from(QUOTE_PHOTOS_BUCKET).remove([photo.storage_path]);
    if (error) throw error;
    return data;
  }
}
