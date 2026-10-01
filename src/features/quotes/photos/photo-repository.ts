import { getLocalDatabase, type QuotesDatabase } from "../data/database";
import { notifyQuoteSaved } from "../data/events";
import { QuoteNotFoundError } from "../data/quote-repository";
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MIME_TYPES, PhotoError, type ActiveQuotePhoto, type PreparedPhoto, type QuotePhoto } from "./types";

export interface QuotePhotoRepository {
  list(quoteId: string): Promise<ActiveQuotePhoto[]>;
  add(quoteId: string, photo: PreparedPhoto): Promise<ActiveQuotePhoto>;
  remove(quoteId: string, photoId: string): Promise<void>;
}

export class LocalQuotePhotoRepository implements QuotePhotoRepository {
  constructor(private readonly database: QuotesDatabase) {}

  async list(quoteId: string): Promise<ActiveQuotePhoto[]> {
    const photos = await this.database.quotePhotos.where("quoteId").equals(quoteId).sortBy("createdAt");
    return photos.filter((photo): photo is ActiveQuotePhoto => photo.deletedAt === null);
  }

  async add(quoteId: string, photo: PreparedPhoto): Promise<ActiveQuotePhoto> {
    // Copy mutable metadata before awaiting; Blobs themselves are immutable.
    const input = { ...photo };
    if (!(input.blob instanceof Blob) || !input.blob.size || input.blob.size > PHOTO_MAX_BYTES ||
      !PHOTO_MIME_TYPES.some((type) => type === input.blob.type) ||
      ![input.width, input.height].every((value) => Number.isInteger(value) && value > 0 && value <= PHOTO_MAX_EDGE)) {
      throw new PhotoError("Zdjęcie nie jest przygotowane do lokalnego zapisu. Wybierz je ponownie.");
    }
    const timestamp = new Date().toISOString();
    const record: ActiveQuotePhoto = {
      id: crypto.randomUUID(), quoteId, createdAt: timestamp, updatedAt: timestamp,
      fileName: input.fileName, originalFileName: input.originalFileName,
      blob: input.blob, mimeType: input.blob.type, size: input.blob.size,
      width: input.width, height: input.height,
      syncStatus: "pending", revision: 1, schemaVersion: 1, deletedAt: null,
    };
    await this.database.transaction("rw", [this.database.quotes, this.database.quotePhotos], async () => {
      if (!await this.database.quotes.get(quoteId)) throw new QuoteNotFoundError();
      await this.database.quotePhotos.add(record);
    });
    notifyQuoteSaved();
    return record;
  }

  async remove(quoteId: string, photoId: string): Promise<void> {
    await this.database.transaction("rw", this.database.quotePhotos, async () => {
      const current = await this.database.quotePhotos.get(photoId);
      if (!current || current.quoteId !== quoteId) throw new PhotoError("Nie znaleziono zdjęcia w tej realizacji. Odśwież galerię.");
      if (current.deletedAt !== null) return;
      const timestamp = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
      const deleted: QuotePhoto = {
        ...current, blob: null, deletedAt: timestamp, updatedAt: timestamp,
        revision: current.revision + 1, syncStatus: current.syncStatus === "conflict" ? "conflict" : "pending",
      };
      await this.database.quotePhotos.put(deleted);
    });
    notifyQuoteSaved();
  }
}

let repository: QuotePhotoRepository | undefined;
export function getQuotePhotoRepository(): QuotePhotoRepository {
  repository ??= new LocalQuotePhotoRepository(getLocalDatabase());
  return repository;
}
