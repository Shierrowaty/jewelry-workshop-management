import type { SavedQuote } from "@/features/quotes/data/types";
import type { QuotePhoto } from "@/features/quotes/photos/types";
import type { CloudPhotoWrite, CloudQuoteWrite, Json } from "./database.types";

export const QUOTE_PHOTOS_BUCKET = "quote-photos";
export function requireUuid(value: string): string {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw new Error("Niepoprawny identyfikator UUID.");
  return value.toLowerCase();
}

export function photoStoragePath(workspaceId: string, quoteId: string, photoId: string, mimeType: string) {
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType];
  if (!extension) throw new Error("Nieobsługiwany format zdjęcia w Storage.");
  return `${requireUuid(workspaceId)}/${requireUuid(quoteId)}/${requireUuid(photoId)}.${extension}`;
}

// Pure mapping, never a local/cloud write and never a recalculation of historical prices.
export function quoteToCloud(quote: SavedQuote, workspaceId: string): CloudQuoteWrite {
  return {
    id: requireUuid(quote.id), workspace_id: requireUuid(workspaceId),
    created_at: quote.createdAt, updated_at: quote.updatedAt, completed_at: quote.completedAt,
    status: quote.status, due_date: quote.dueDate || null, notes: quote.notes,
    revision: quote.revision, schema_version: quote.schemaVersion, calculation_version: quote.calculationVersion,
    snapshot: structuredClone(quote.snapshot) as Json, deleted_at: null,
  };
}

export function photoToCloud(photo: QuotePhoto, workspaceId: string): CloudPhotoWrite {
  return {
    id: requireUuid(photo.id), quote_id: requireUuid(photo.quoteId), workspace_id: requireUuid(workspaceId),
    created_at: photo.createdAt, updated_at: photo.updatedAt, revision: photo.revision,
    schema_version: photo.schemaVersion, file_name: photo.fileName, original_file_name: photo.originalFileName,
    mime_type: photo.mimeType, size: photo.size, width: photo.width, height: photo.height,
    storage_path: photoStoragePath(workspaceId, photo.quoteId, photo.id, photo.mimeType), deleted_at: photo.deletedAt,
  };
}
