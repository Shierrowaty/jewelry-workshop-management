import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { requireUuid } from "./mappers";

export async function getUserWorkspace(client: SupabaseClient<Database>, userId: string) {
  const { data: members, error } = await client.from("workspace_members").select("workspace_id").eq("user_id", requireUuid(userId)).limit(2);
  if (error) throw error;
  if (!members.length) throw new Error("Twoje konto nie należy do żadnej pracowni. Poproś administratora o dodanie do workspace. Dane lokalne są nadal dostępne.");
  if (members.length > 1) throw new Error("Twoje konto należy do więcej niż jednej pracowni. B1 obsługuje jedną — wybór wymaga obsługi administratora. Synchronizacja jest wstrzymana.");
  const { data, error: workspaceError } = await client.from("workspaces").select("id,name").eq("id", members[0].workspace_id).single();
  if (workspaceError) throw workspaceError;
  return data;
}
