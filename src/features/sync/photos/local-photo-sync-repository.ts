import { logsFor } from "../../diagnostics/logs";
import type { CloudPhoto, CloudPhotoWrite } from "@/lib/supabase/database.types";
import { photoToCloud } from "@/lib/supabase/mappers";
import type { QuotesDatabase } from "../../quotes/data/database";
import type { QuotePhoto } from "../../quotes/photos/types";
import { LocalSyncRepository } from "../local-sync-repository";
import type { PhotoSyncState } from "./types";
import { samePhotoIdentity } from "./validation";

export class LocalPhotoSyncRepository {
  logFailure(error: unknown, quoteId: string, photoId: string) { return logsFor(this.db).record("photo", error, { quoteId, photoId }); }
  constructor(private readonly db: QuotesDatabase, private readonly scope: { projectUrl: string; workspaceId: string }) {}
  async assertScope() { await new LocalSyncRepository(this.db).assertBinding(this.scope.projectUrl, this.scope.workspaceId); }
  async ids() { return [...new Set([...await this.db.quotePhotos.toCollection().primaryKeys(), ...await this.db.photoSync.toCollection().primaryKeys()])]; }
  async read(id: string) { return { photo: await this.db.quotePhotos.get(id), state: await this.db.photoSync.get(id) }; }
  quote(id: string) { return this.db.quotes.get(id); }
  private transaction<T>(action: () => Promise<T>) {
    return this.db.transaction("rw", [this.db.quotePhotos, this.db.photoSync, this.db.syncSettings, this.db.quotes], async () => { await this.assertScope(); return action(); });
  }
  private empty(id: string, quoteId: string): PhotoSyncState {
    return { photoId: id, quoteId, base: null, inFlight: null, phase: "metadata", conflict: null, error: null };
  }
  async journal(id: string, quoteId: string, patch: Partial<PhotoSyncState>) {
    await this.transaction(async () => {
      const state = await this.db.photoSync.get(id) ?? this.empty(id, quoteId);
      await this.db.photoSync.put({ ...state, ...patch, photoId: id, quoteId });
    });
  }
  async conflict(id: string, quoteId: string, cloud: CloudPhoto | null, message: string) {
    await this.transaction(async () => {
      const current = await this.db.quotePhotos.get(id);
      if (current) await this.db.quotePhotos.put({ ...current, syncStatus: "conflict" });
      const state = await this.db.photoSync.get(id) ?? this.empty(id, quoteId);
      await this.db.photoSync.put({ ...state, phase: "conflict", conflict: cloud, error: message });
    });
  }
  async prepare(id: string, cloud: CloudPhoto | null) {
    return this.transaction(async () => {
      const photo = await this.db.quotePhotos.get(id);
      if (!photo || photo.syncStatus === "conflict") return null;
      const parent = await this.db.quotes.get(photo.quoteId);
      if (parent?.syncStatus !== "synced") return null;
      const state = await this.db.photoSync.get(id) ?? this.empty(id, photo.quoteId);
      const row: CloudPhotoWrite = { ...photoToCloud(photo, this.scope.workspaceId), revision: (cloud?.revision ?? 0) + 1 };
      await this.db.photoSync.put({ ...state, phase: "metadata", error: null, inFlight: { row, localRevision: photo.revision } });
      return row;
    });
  }
  async tombstone(row: CloudPhoto, done: boolean) {
    await this.transaction(async () => {
      const current = await this.db.quotePhotos.get(row.id);
      if (current && !samePhotoIdentity(photoToCloud(current, this.scope.workspaceId), row)) throw new Error("Tożsamość zdjęcia zmieniła się podczas usuwania.");
      if (!row.deleted_at) throw new Error("Brak znacznika usunięcia.");
      if (!await this.db.quotes.get(row.quote_id)) return;
      const state = await this.db.photoSync.get(row.id) ?? this.empty(row.id, row.quote_id);
      await this.db.quotePhotos.put({ ...this.fromCloud(row), blob: null, deletedAt: row.deleted_at,
        revision: current ? current.revision + (current.deletedAt ? 0 : 1) : row.revision, syncStatus: done ? "synced" : "pending" });
      await this.db.photoSync.put({ ...state, base: row, inFlight: null, conflict: null, phase: done ? "done" : "delete", error: null });
    });
  }
  private fromCloud(row: CloudPhoto) {
    return { id: row.id, quoteId: row.quote_id, createdAt: row.created_at, updatedAt: row.updated_at,
      fileName: row.file_name, originalFileName: row.original_file_name, mimeType: row.mime_type,
      size: row.size, width: row.width, height: row.height, schemaVersion: 1 as const };
  }
  async finishActive(row: CloudPhoto, blob: Blob, expectedRevision: number | null) {
    return this.transaction(async () => {
      const current = await this.db.quotePhotos.get(row.id);
      // Never resurrect a local delete, including one made while downloading/uploading.
      if ((current?.revision ?? null) !== expectedRevision || current?.deletedAt || current?.syncStatus === "conflict") return false;
      if (!await this.db.quotes.get(row.quote_id)) return false;
      const record: QuotePhoto = { ...this.fromCloud(row), blob, deletedAt: null, revision: current?.revision ?? row.revision, syncStatus: "synced" };
      await this.db.quotePhotos.put(record);
      await this.db.photoSync.put({ ...this.empty(row.id, row.quote_id), base: row, phase: "done" });
      return true;
    });
  }
}
