import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { getSupabaseConfig } from "./src/lib/supabase/config";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Service-Worker-Allowed", value: "/" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
};
export default function configure(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    // Next has loaded .env files before this hook. Fail before publishing a
    // bundle with missing/invalid NEXT_PUBLIC values frozen into it.
    try {
      const { url } = getSupabaseConfig();
      if (new URL(url).protocol !== "https:") throw new Error("Production requires HTTPS.");
    } catch {
      throw new Error("Build przerwany: ustaw NEXT_PUBLIC_SUPABASE_URL (HTTPS) oraz NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (publiczny sb_publishable_) w środowisku buildu. Secret/service_role nie są dozwolone. Sprawdź ENV w Vercel lub .env.local.");
    }
  }
  return nextConfig;
}
