# Security and privacy boundaries

The release contains application source, schema migrations and synthetic fixtures. It does not include a production database, customer export, session storage or operational environment file.

Only the Supabase URL and public publishable key belong in NEXT_PUBLIC configuration. Public configuration does not authorize access by itself: workspace membership and row-level security enforce cloud permissions. Secret and service-role keys are rejected by the application configuration.

Photographs use a private bucket and workspace-scoped paths. Diagnostic reports use allowlisted metadata instead of copying arbitrary error bodies or quotation data.

## Local data

Application login governs cloud access. It does not encrypt IndexedDB or block an unauthenticated person with access to the same browser profile from viewing local records. Local data depends on the origin, profile and device. Clearing site data, deleting the profile or losing the device can lose unsynchronized work.

The service worker caches the application interface, not business records or authentication responses. Browser storage is not a versioned backup.

## Evaluation

Use fictional records and an independent cloud project. The sample emails in account greetings and test fixtures are reserved example.invalid addresses; they do not create accounts or bypass authentication. Keep environment files, test profiles, logs and generated build output out of version control.

No external security audit or production certification is claimed.
