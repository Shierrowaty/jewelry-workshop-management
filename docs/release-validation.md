# Release validation

Validation date: 2026-10-01. Neutral-brand portfolio snapshot.

| Check | Result |
| --- | --- |
| Financial calculations | 39 passed |
| Local data | 46 passed |
| Cloud schema and RLS | 32 passed |
| Synchronization and diagnostics | 77 passed |
| PWA and release configuration | 10 passed |
| ESLint | Passed with zero warnings |
| Production build | Passed; generated service worker includes 54 UI assets |
| Browser end-to-end suite | All 8 scenarios passed; PWA scenario verified separately after an initial failed run |
| Relative Markdown links | All targets resolved |
| Public-content review | Source, documentation, fixtures and assets reviewed; neutral branding, reserved example contacts, no production environment or customer export found |
| Screenshots | Four actual application captures with synthetic inputs; visually reviewed |

Total non-browser tests: 204 passed, none skipped.

Environment: Windows, Node.js 22.18.0, project lockfile dependencies. The build used a synthetic HTTPS Supabase URL and public test key. No live Supabase database was contacted.

Browser checks used Playwright 1.62.1 with installed Microsoft Edge (`PLAYWRIGHT_CHANNEL=msedge`). The initial combined run passed seven scenarios but failed the PWA offline restart while another test invocation shared the output/profile directory. The PWA scenario then passed in isolation, including offline restart with the application server stopped. Run Playwright suites sequentially because they share `test-results`. Physical PWA installation on Windows, macOS and iOS was not tested.

The knowledge-group regression test uses a static import so the test runner consistently resolves application aliases on Windows. Its assertions are unchanged.

The text scan covered legacy brand variants and identifiers, credential patterns, private keys, JWTs, credential-bearing database URLs and personal filesystem paths. Email and URL matches were reviewed as synthetic fixtures, local development addresses or placeholders. All 27 relative Markdown links resolved. The four screenshots were recreated from a fresh browser context using fictional data; the SVG and all three raster app icons use a neutral geometric gem. No automated scan guarantees the absence of every possible secret.

The catalog synchronization browser test waits for the committed workspace binding before navigating away from the connection screen.

Application database migrations are retained. The portfolio has a separate empty database namespace and does not import operational records. The source is delivered as one root commit without development history.
