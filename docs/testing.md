# Testing

## Commands

```bash
npm ci
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Production build requires valid cloud configuration. For isolated browser tests only, a synthetic configuration can be used in a fresh shell:

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_synthetic
npm run build
npm run test:e2e
```

Never deploy that synthetic build or connect it to operational records. A genuine deployment needs its own configuration. Windows browser tests can alternatively use PLAYWRIGHT_CHANNEL=msedge.

## Coverage

| Test project | Focus |
| --- | --- |
| calculations | Exact pricing, separators, gold fineness and loss thresholds |
| data | IndexedDB transactions, migrations, snapshots, catalog and calculator |
| cloud | Schema, constraints and workspace RLS in PGlite |
| sync | Retries, lost responses, conflicts, photographs and diagnostics |
| pwa | Manifest, worker policy and production configuration |
| browser | Form, persistence, calculator and knowledge-base interaction |
| sync-browser | Two isolated devices with synthetic cloud transport |
| pwa-browser | Prepared offline interface and session behavior |

Profiles and outputs live in ignored test-results directories. Browser tests launch their own local servers. They do not use the user's existing browser profile or the workshop's live database.

## Public snapshot validation

See release-validation.md for the checks actually executed on this public snapshot. Test presence alone is not a claim that a check passed.
