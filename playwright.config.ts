import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  projects: [
    { name: "pwa", testMatch: ["pwa.spec.ts", "release-config.spec.ts"] },
    { name: "pwa-browser", testMatch: "pwa-e2e.spec.ts", timeout: 240_000 },
    { name: "data", testMatch: ["local-database.spec.ts", "quote-photos.spec.ts", "knowledge.spec.ts", "calculator.spec.ts"] },
    { name: "cloud", testMatch: ["supabase-foundation.spec.ts", "supabase-rls.spec.ts"], timeout: 60_000 },
    { name: "sync", testMatch: ["knowledge-sync.spec.ts", "quote-sync.spec.ts", "photo-sync.spec.ts", "diagnostics.spec.ts", "launcher.spec.ts"], timeout: 60_000 },
    { name: "sync-browser", testMatch: ["sync-e2e.spec.ts", "knowledge-sync-e2e.spec.ts"], timeout: 240_000 },
    { name: "browser", testMatch: ["local-persistence.spec.ts", "knowledge-e2e.spec.ts", "calculator-e2e.spec.ts"], timeout: 240_000 },
  ],
});
