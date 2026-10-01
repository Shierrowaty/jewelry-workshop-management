import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type AuthClient = Pick<SupabaseClient<Database>, "auth">;

// Explicit operations only. No redirects, route guards, subscriptions or Dexie changes.
export async function signIn(client: AuthClient, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data.user;
}

export async function signOut(client: AuthClient) {
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
}

export async function getUser(client: AuthClient) {
  // Verifies against Auth; never authorize with getSession's unverified cookie payload.
  const { data, error } = await client.auth.getUser();
  if (error?.name === "AuthSessionMissingError") return null;
  if (error) throw error;
  return data.user;
}
