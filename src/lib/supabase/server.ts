import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

// Route Handler helper. Return this exact response to preserve all cookies/cache headers.
// Do not share clients between requests or call this from cached Server Components.
export async function createServerSupabaseClient(response: NextResponse) {
  const { url, publishableKey } = getSupabaseConfig();
  const requestCookies = await cookies();
  const values = new Map(requestCookies.getAll().map(({ name, value }) => [name, value]));
  response.headers.set("Cache-Control", "private, no-store");
  return createServerClient<Database>(url, publishableKey, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookies: {
      getAll: () => Array.from(values, ([name, value]) => ({ name, value })),
      setAll(changes, headers) {
        for (const { name, value, options } of changes) {
          values.set(name, value);
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });
}
