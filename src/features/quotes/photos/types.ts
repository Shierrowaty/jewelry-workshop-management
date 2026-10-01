export const PHOTO_MAX_EDGE = 1920;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PreparedPhoto = {
  fileName: string;
  originalFileName: string;
  blob: Blob;
  width: number;
  height: number;
};

type PhotoMetadata = {
  id: string;
  quoteId: string;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  syncStatus: "local" | "pending" | "synced" | "conflict";
  revision: number;
  schemaVersion: 1;
};

export type ActiveQuotePhoto = PhotoMetadata & { blob: Blob; deletedAt: null };
// Keep a small deletion marker for future sync, but release the local image bytes.
export type QuotePhoto = ActiveQuotePhoto | (PhotoMetadata & { blob: null; deletedAt: string });

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}
