import type { CloudPhoto, CloudPhotoWrite } from "@/lib/supabase/database.types";
import { photoStoragePath, requireUuid } from "@/lib/supabase/mappers";
import { imageType } from "../../quotes/photos/prepare-photo";
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MIME_TYPES } from "../../quotes/photos/types";
import { timeMicros } from "../quote-validation";

export const photoVersion = (row: CloudPhoto) => ({ revision: row.revision, serverUpdatedAt: row.server_updated_at });
export function validatePhoto(row: CloudPhoto, workspaceId: string) {
  if (requireUuid(row.workspace_id) !== requireUuid(workspaceId)) throw new Error("Odrzucono zdjęcie z innej pracowni.");
  if (row.storage_path !== photoStoragePath(workspaceId, row.quote_id, row.id, row.mime_type) || row.schema_version !== 1 ||
    !Number.isSafeInteger(row.revision) || row.revision < 1 || !PHOTO_MIME_TYPES.some(type => type === row.mime_type) ||
    !Number.isInteger(row.size) || row.size < 1 || row.size > PHOTO_MAX_BYTES ||
    ![row.width, row.height].every(n => Number.isInteger(n) && n > 0 && n <= PHOTO_MAX_EDGE) ||
    typeof row.file_name !== "string" || typeof row.original_file_name !== "string") {
    throw new Error("Niepoprawne metadane zdjęcia w chmurze. Lokalny plik zachowano.");
  }
  [row.created_at, row.updated_at, row.server_updated_at].forEach(timeMicros);
  if (row.deleted_at !== null) timeMicros(row.deleted_at);
}
// Replacing a file requires a NEW UUID; B2 changes only its deletion state.
export function samePhotoIdentity(a: CloudPhotoWrite, b: CloudPhotoWrite) {
  return (["id", "quote_id", "workspace_id", "schema_version", "file_name", "original_file_name", "mime_type", "size", "width", "height", "storage_path"] as const)
    .every(key => a[key] === b[key]) && timeMicros(a.created_at) === timeMicros(b.created_at);
}
export async function validatePhotoBlob(row: CloudPhotoWrite, blob: Blob) {
  if (!(blob instanceof Blob) || blob.size !== row.size || blob.size > PHOTO_MAX_BYTES || blob.type !== row.mime_type || await imageType(blob) !== row.mime_type) {
    throw new Error("Plik zdjęcia nie odpowiada metadanym (format lub rozmiar). Dane lokalne zachowano.");
  }
  // Decode only, with the same EXIF orientation as local preparation; never recompress.
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    try {
      if (bitmap.width !== row.width || bitmap.height !== row.height) throw new Error("Wymiary zdjęcia nie odpowiadają metadanym.");
    } finally { bitmap.close(); }
  }
}
export async function sameBytes(a: Blob, b: Blob) {
  if (a.size !== b.size || a.type !== b.type) return false;
  const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const bytes = new Uint8Array(right);
  return new Uint8Array(left).every((value, i) => value === bytes[i]);
}
export function storageAlreadyExists(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { statusCode?: string | number; status?: number; error?: string; code?: string; message?: string };
  return value.statusCode === "409" || value.statusCode === 409 || value.status === 409 ||
    [value.error, value.code].includes("Duplicate") || /already exists|duplicate/i.test(value.message ?? "");
}
