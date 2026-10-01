import type { CloudPhoto } from "@/lib/supabase/database.types";
import { nextChangeCursor, type ChangeCursor } from "@/lib/supabase/cloud-repository";
import { photoToCloud } from "@/lib/supabase/mappers";
import { sameVersion } from "../quote-validation";
import type { LocalPhotoSyncRepository } from "./local-photo-sync-repository";
import type { PhotoSyncRemote } from "./types";
import { photoVersion, sameBytes, samePhotoIdentity, storageAlreadyExists, validatePhoto, validatePhotoBlob } from "./validation";

const conflictMessage = "Konflikt zdjęcia: ten sam identyfikator ma inną zawartość. Zachowano lokalny plik; potrzebne jest wyjaśnienie z administratorem.";
export class PhotoSyncEngine {
  constructor(private readonly local: LocalPhotoSyncRepository, private readonly remote: PhotoSyncRemote,
    private readonly checkActive: () => void = () => {}, private readonly betweenPhotos: () => Promise<void> = async () => {}) {}

  async run() {
    this.checkActive(); await this.local.assertScope();
    let cursor: ChangeCursor | undefined;
    const processed = new Set<string>();
    let failures = 0;
    const visit = async (id: string, quoteId: string) => {
      this.checkActive();
      try { await this.process(id); }
      catch (error) {
        this.checkActive(); failures++;
        await this.local.logFailure(error, quoteId, id);
        await this.local.journal(id, quoteId, { error: error instanceof Error ? error.message : "Nie udało się przesłać zdjęcia. Ponów synchronizację." });
      }
      processed.add(id);
      // Let newly saved quotes synchronize between files, even with a large gallery.
      await this.betweenPhotos(); this.checkActive();
    };
    for (let page = 0; ; page++) {
      if (page === 1000) throw new Error("Przekroczono limit stron zdjęć. Ponów synchronizację.");
      this.checkActive();
      const rows = await this.remote.fetchChangedPhotoMetadata(cursor, 100);
      this.checkActive();
      for (const row of rows) {
        validatePhoto(row, this.remote.workspaceId); // Never journal foreign/untrusted identifiers.
        if (!processed.has(row.id)) await visit(row.id, row.quote_id);
      }
      if (rows.length < 100) break;
      const next = nextChangeCursor(rows);
      if (!next || (next.id === cursor?.id && next.serverUpdatedAt === cursor.serverUpdatedAt)) throw new Error("Nie można kontynuować pobierania zdjęć.");
      cursor = next;
    }
    for (const id of await this.local.ids()) {
      if (processed.has(id)) continue;
      const { photo, state } = await this.local.read(id);
      const quoteId = photo?.quoteId ?? state?.quoteId;
      if (quoteId) await visit(id, quoteId);
    }
    if (failures) throw new Error(`Nie udało się zsynchronizować zdjęć: ${failures}. Wyceny zapisano niezależnie. Szczegóły znajdziesz przy galerii; użyj „Synchronizuj”, aby ponowić.`);
  }

  private async process(id: string, attempt = 0): Promise<void> {
    if (attempt > 3) throw new Error("Zdjęcie zmienia się podczas synchronizacji. Ponów po zakończeniu zmian.");
    this.checkActive(); await this.local.assertScope();
    const cloud = await this.remote.getPhotoMetadata(id);
    this.checkActive();
    if (cloud) validatePhoto(cloud, this.remote.workspaceId);
    const { photo, state } = await this.local.read(id);
    const quoteId = photo?.quoteId ?? cloud?.quote_id ?? state?.quoteId;
    if (!quoteId) return;
    if (state?.phase === "conflict" || photo?.syncStatus === "conflict") return;
    if (cloud && photo && !samePhotoIdentity(photoToCloud(photo, this.remote.workspaceId), cloud)) {
      await this.local.conflict(id, quoteId, cloud, conflictMessage); return;
    }
    if (!cloud && state?.base) {
      await this.local.conflict(id, quoteId, null, "Metadane zdjęcia zniknęły z chmury. Lokalny rekord zachowano; synchronizacja wymaga wyjaśnienia."); return;
    }
    // A matching tombstone is terminal. No device clock and no implicit restore.
    if (cloud?.deleted_at) {
      await this.local.tombstone(cloud, false);
      this.checkActive();
      // Repeat cleanup for tombstones on later runs too: an old interrupted upload may finish late.
      await this.remote.removePhotoFile(cloud);
      this.checkActive();
      const latest = await this.remote.getPhotoMetadata(id);
      this.checkActive();
      if (!latest || !sameVersion(photoVersion(cloud), photoVersion(latest))) {
        await this.local.conflict(id, quoteId, latest, "Znacznik usunięcia zdjęcia zmienił się w chmurze. Zdjęcie pozostaje usunięte lokalnie."); return;
      }
      await this.local.tombstone(cloud, true); return;
    }
    if (!await this.local.quote(quoteId)) throw new Error("Zdjęcie oczekuje na pobranie powiązanej realizacji.");
    if (!cloud || photo?.deletedAt) {
      // The quote must have completed B1 before any photo metadata write (FK and local intent).
      if ((await this.local.quote(quoteId))?.syncStatus !== "synced") throw new Error("Zdjęcie oczekuje na synchronizację wyceny.");
      const parent = await this.remote.getQuote(quoteId);
      this.checkActive();
      if (!parent || parent.workspace_id !== this.remote.workspaceId || parent.deleted_at) throw new Error("Brak aktywnej realizacji w chmurze. Zdjęcie zachowano lokalnie.");
      const row = await this.local.prepare(id, cloud);
      if (!row) return;
      this.checkActive();
      const saved = await this.remote.savePhotoConditionally(row, cloud ? photoVersion(cloud) : null);
      this.checkActive();
      if (saved) {
        validatePhoto(saved, this.remote.workspaceId);
        await this.local.journal(id, quoteId, { base: saved, phase: saved.deleted_at ? "delete" : "upload", error: null });
      }
      // Refetch even after success: handles lost replies, simultaneous inserts/deletes and CAS misses.
      return this.process(id, attempt + 1);
    }
    if (photo && state?.phase === "done" && state.base && sameVersion(photoVersion(state.base), photoVersion(cloud)) && photo.syncStatus === "synced") return;
    if (photo && (await this.local.quote(quoteId))?.syncStatus !== "synced") throw new Error("Zdjęcie oczekuje na synchronizację wyceny.");
    await this.local.journal(id, quoteId, { base: cloud, phase: photo ? "upload" : "download", error: null });
    this.checkActive();
    if (!photo) {
      const blob = await this.remote.downloadPhoto(cloud);
      this.checkActive(); await validatePhotoBlob(cloud, blob);
      if (!await this.stillCurrent(cloud)) return this.process(id, attempt + 1);
      if (!await this.local.finishActive(cloud, blob, null)) return this.process(id, attempt + 1);
      return;
    }
    if (!photo.blob) return; // A local tombstone can only reach the deletion branch above.
    await validatePhotoBlob(cloud, photo.blob);
    this.checkActive();
    try { await this.remote.uploadPhoto(cloud, photo.blob); }
    catch (error) {
      this.checkActive();
      if (!storageAlreadyExists(error)) throw error;
      // Exact bytes, not filename/size alone. Never use upsert:true on an existing object.
      const existing = await this.remote.downloadPhoto(cloud);
      this.checkActive(); await validatePhotoBlob(cloud, existing);
      if (!await sameBytes(photo.blob, existing)) {
        await this.local.conflict(id, quoteId, cloud, conflictMessage); return;
      }
    }
    this.checkActive();
    if (!await this.stillCurrent(cloud)) return this.process(id, attempt + 1);
    if (!await this.local.finishActive(cloud, photo.blob, photo.revision)) return this.process(id, attempt + 1);
  }

  private async stillCurrent(row: CloudPhoto) {
    const latest = await this.remote.getPhotoMetadata(row.id);
    this.checkActive();
    if (latest) validatePhoto(latest, this.remote.workspaceId);
    return !!latest && sameVersion(photoVersion(latest), photoVersion(row));
  }
}
