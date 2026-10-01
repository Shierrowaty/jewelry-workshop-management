import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // Standalone Node launcher uses native CommonJS, also readable by the test runner.
  { files: ["scripts/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  globalIgnores(["public/sw.js", ".next/**", "out/**", "build/**", "test-results/**", "playwright-report/**", "next-env.d.ts"]),
]);
