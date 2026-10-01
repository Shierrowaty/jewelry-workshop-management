import type { CloudPhoto, CloudPhotoWrite, CloudQuote } from "@/lib/supabase/database.types";
import type { ChangeCursor } from "@/lib/supabase/cloud-repository";
import type { CloudVersion } from "../types";

export type PhotoSyncState = {
  photoId: string; quoteId: string;
  base: CloudPhoto | null;
  inFlight: { row: CloudPhotoWrite; localRevision: number } | null;
  phase: "metadata" | "upload" | "download" | "delete" | "done" | "conflict";
  conflict: CloudPhoto | null;
  error: string | null;
};
export interface PhotoSyncRemote {
  workspaceId: string;
  getQuote(id: string): Promise<CloudQuote | null>;
  getPhotoMetadata(id: string): Promise<CloudPhoto | null>;
  fetchChangedPhotoMetadata(cursor?: ChangeCursor, limit?: number): Promise<CloudPhoto[]>;
  savePhotoConditionally(row: CloudPhotoWrite, base: CloudVersion | null): Promise<CloudPhoto | null>;
  uploadPhoto(row: CloudPhotoWrite, blob: Blob): Promise<unknown>;
  downloadPhoto(row: CloudPhotoWrite): Promise<Blob>;
  removePhotoFile(row: CloudPhotoWrite): Promise<unknown>;
}
