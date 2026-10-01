import type { CloudQuote, CloudQuoteWrite } from "@/lib/supabase/database.types";
import type { ChangeCursor } from "@/lib/supabase/cloud-repository";

export type CloudVersion = { revision: number; serverUpdatedAt: string };
export type QuoteSyncState = {
  quoteId: string;
  base: CloudVersion | null;
  conflict: CloudQuote | null;
  // Durable evidence of a request whose response can be lost. Contains no photos or credentials.
  inFlight: { localRevision: number; row: CloudQuoteWrite } | null;
};
export type Workspace = { id: string; name: string };
export type SyncWorkspace = {
  key: "workspace";
  projectUrl: string;
  workspaceId: string;
  workspaceName: string;
  lastSyncedAt: string | null;
  // Full B1+B2 success. Older B1-only timestamps are deliberately not reused.
  lastSuccessfulSyncAt?: string | null;
  syncPaused?: boolean;
};
export interface QuoteSyncRemote {
  readonly workspaceId: string;
  fetchChangedQuotes(cursor?: ChangeCursor, limit?: number): Promise<CloudQuote[]>;
  getQuote(id: string): Promise<CloudQuote | null>;
  // Null means the compare-and-set failed, never unconditional last-write-wins.
  saveQuoteConditionally(row: CloudQuoteWrite, base: CloudVersion | null): Promise<CloudQuote | null>;
}
