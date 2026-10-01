export type SupabaseEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

// Lazy validation: importing cloud code must never break local pages or a build without env.
export function getSupabaseConfig(environment: SupabaseEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) throw new Error("Brak konfiguracji Supabase. Uzupełnij NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY w .env.local. Lokalna aplikacja może działać bez nich.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL musi być poprawnym adresem HTTPS."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL musi wskazywać adres projektu HTTPS (HTTP dozwolone tylko lokalnie).");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error("Użyj publicznego klucza publishable Supabase. Klucze secret, service_role i dawne klucze JWT nie są dozwolone w tej konfiguracji.");
  }
  return { url: parsed.origin, publishableKey };
}
