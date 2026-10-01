import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import configure from "../next.config";

test("release build odrzuca brak ENV, HTTP i klucze prywatne bez ujawniania wartości", () => {
  const saved = { ...process.env };
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(() => configure(PHASE_DEVELOPMENT_SERVER)).not.toThrow();
    expect(() => configure(PHASE_PRODUCTION_BUILD)).toThrow("Build przerwany");
    const examples = [
      ["https://project.example", "sb_secret_test"],
      ["http://127.0.0.1:54321", "sb_publishable_synthetic"],
      ["https://user:synthetic-password@project.example", "sb_publishable_synthetic"],
      ["not-a-url", "sb_publishable_synthetic"],
    ];
    for (const [url, key] of examples) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
      let message = "";
      try { configure(PHASE_PRODUCTION_BUILD); } catch (error) { message = (error as Error).message; }
      expect(message).toContain("Build przerwany");
      expect(message).not.toContain(key);
      expect(message).not.toContain(url);
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_synthetic";
    expect(() => configure(PHASE_PRODUCTION_BUILD)).not.toThrow();
  } finally {
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test("Vercel wykonuje pełny build z generatorem PWA, bez launchera Windows", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(vercel).toEqual({ framework: "nextjs", buildCommand: "npm run build" });
  expect(pkg.scripts.build).toBe("next build && node scripts/build-pwa.cjs");
});
