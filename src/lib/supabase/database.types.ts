// Contract for 20260904000100_cloud_foundation.sql. Regenerate/compare after deploying migrations.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type CloudQuote = {
  id: string; workspace_id: string; created_at: string; updated_at: string;
  completed_at: string | null; status: string; due_date: string | null; notes: string;
  revision: number; schema_version: number; calculation_version: number;
  snapshot: Json; deleted_at: string | null; server_updated_at: string;
};
export type CloudPhoto = {
  id: string; quote_id: string; workspace_id: string; created_at: string; updated_at: string;
  revision: number; schema_version: number; file_name: string; original_file_name: string;
  mime_type: string; size: number; width: number; height: number; storage_path: string;
  deleted_at: string | null; server_updated_at: string;
};
export type CloudKnowledge = {
  id: string; workspace_id: string; created_at: string; updated_at: string;
  revision: number; schema_version: number; payload: Json;
  deleted_at: string | null; server_updated_at: string;
};
export type CloudKnowledgeWrite = Omit<CloudKnowledge, "server_updated_at">;
export type CloudQuoteWrite = Omit<CloudQuote, "server_updated_at">;
export type CloudPhotoWrite = Omit<CloudPhoto, "server_updated_at">;
type Workspace = { id: string; name: string; created_at: string };
type Member = { workspace_id: string; user_id: string; role: "owner" | "member"; created_at: string };
type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };
export type Database = {
  public: {
    Tables: {
      workspaces: Table<Workspace, { id?: string; name: string; created_at?: string }, { name?: string }>;
      workspace_members: Table<Member, Omit<Member, "created_at"> & { created_at?: string }, Partial<Member>>;
      knowledge_categories: Table<CloudKnowledge, CloudKnowledgeWrite, Partial<CloudKnowledgeWrite>>;
      knowledge_entries: Table<CloudKnowledge, CloudKnowledgeWrite, Partial<CloudKnowledgeWrite>>;
      quotes: Table<CloudQuote, CloudQuoteWrite, Partial<CloudQuoteWrite>>;
      quote_photos: Table<CloudPhoto, CloudPhotoWrite, Partial<CloudPhotoWrite>>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
