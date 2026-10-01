"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

let browserClient: SupabaseClient<Database> | undefined;

// B1 is browser-only Auth: the official SDK persists its session in localStorage.
// Quote/photo data stays in Dexie. No server-rendered page consumes this session.
export function createBrowserSupabaseClient() {
  if (typeof window === "undefined") throw new Error("Klient przeglądarkowy Supabase wymaga przeglądarki.");
  const { url, publishableKey } = getSupabaseConfig();
  browserClient ??= createClient<Database>(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(15_000) }) },
  });
  return browserClient;
}
