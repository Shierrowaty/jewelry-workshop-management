# Getting started

## Local evaluation

Install Node.js 22.18 or newer, extract or clone the repository, then run:

```bash
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open http://127.0.0.1:3000. No cloud configuration is needed for local development. On Windows PowerShell, use npm.cmd if the execution policy blocks npm.ps1. The optional scripts/start-app.bat launcher starts or recognizes the application on port 3000.

Use one fixed address, port and regular browser profile. localhost and 127.0.0.1 have different databases.

## Independent cloud project

Create a separate Supabase project for evaluation. Copy .env.example to .env.local and replace both placeholders with that project's HTTPS URL and public publishable key. Restart the development server after changing configuration.

Apply these migrations, in order, to the new empty project:

1. supabase/migrations/20260904000100_cloud_foundation.sql
2. supabase/migrations/20260907000100_knowledge_sync.sql

Create user accounts through Supabase Authentication. Using the administrative SQL Editor, create a demo workspace:

```sql
insert into public.workspaces(name)
values ('Demo workshop')
returning id;
```

Substitute the returned workspace UUID and the Auth user's UUID:

```sql
insert into public.workspace_members(workspace_id, user_id, role)
values ('<WORKSPACE_UUID>', '<AUTH_USER_UUID>', 'owner');
```

Use member for a user who should not rename the workspace. Workspace and membership provisioning is administrative; the browser application does not grant itself these rights.

The quote-photos bucket must remain private. The foundation migration sets its supported MIME types and 2 MiB size limit. Do not expose the private helper schema in the Data API or widen workspace policies to anonymous users.

Sign in at /logowanie, inspect the workspace and explicitly connect the local database. Do not apply these instructions to the operational workshop project.

## Production and PWA

Production build validation requires an HTTPS Supabase URL and a public sb_publishable_ key:

```bash
npm run build
npm run start -- --hostname 127.0.0.1
```

The build generates public/sw.js; it is not committed. Keep the application open until offline preparation completes before testing a network interruption.

For deployment, supply your own project configuration at build time and configure Auth URLs for your hosting domain. Hosting, a public live demo and validation on physical iOS/macOS devices are not included in this repository release.
