-- Cloud foundation only. This migration never reads or changes IndexedDB.
begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id, workspace_id);

create table public.quotes (
  id uuid primary key, -- Mandatory local UUID; no server-generated replacement.
  workspace_id uuid not null references public.workspaces(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  status text not null,
  due_date date,
  notes text not null default '',
  revision integer not null check (revision > 0),
  schema_version integer not null check (schema_version > 0),
  calculation_version integer not null check (calculation_version > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  unique (id, workspace_id)
);
create index quotes_changes_idx on public.quotes(workspace_id, server_updated_at, id);

create table public.quote_photos (
  id uuid primary key,
  quote_id uuid not null,
  workspace_id uuid not null references public.workspaces(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision integer not null check (revision > 0),
  schema_version integer not null check (schema_version > 0),
  file_name text not null,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size integer not null check (size between 1 and 2097152),
  width integer not null check (width between 1 and 1920),
  height integer not null check (height between 1 and 1920),
  storage_path text not null unique,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  foreign key (quote_id, workspace_id) references public.quotes(id, workspace_id),
  check (storage_path = workspace_id::text || '/' || quote_id::text || '/' || id::text ||
    case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end)
);
create index quote_photos_quote_idx on public.quote_photos(quote_id, workspace_id);
create index quote_photos_changes_idx on public.quote_photos(workspace_id, server_updated_at, id);

-- SECURITY DEFINER prevents recursive membership RLS. No caller-supplied user ID.
-- These functions expose only the current user's membership, never arbitrary members.
create function private.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
  );
$$;
create function private.is_workspace_owner(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
revoke all on function private.is_workspace_member(uuid), private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid), private.is_workspace_owner(uuid) to authenticated;

-- Preserve the identity/tenant of existing records, even for a member of two workspaces.
-- Client updated_at stays intact; a separate server timestamp supports future incremental reads.
create function private.guard_cloud_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Record identity, workspace and created_at are immutable' using errcode = '23514';
    end if;
    if tg_table_name = 'quote_photos' then
      if new.quote_id is distinct from old.quote_id or new.storage_path is distinct from old.storage_path then
        raise exception 'Photo association and storage_path are immutable' using errcode = '23514';
      end if;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_cloud_record() from public, anon, authenticated;
create trigger quotes_guard before insert or update on public.quotes
  for each row execute function private.guard_cloud_record();
create trigger quote_photos_guard before insert or update on public.quote_photos
  for each row execute function private.guard_cloud_record();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_photos enable row level security;

revoke all on public.workspaces, public.workspace_members, public.quotes, public.quote_photos from public, anon, authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;
grant update (name) on public.workspaces to authenticated;
grant select, insert, update on public.quotes, public.quote_photos to authenticated;
-- No client hard-delete. Workspace/member provisioning is admin-only for this stage.
create policy workspace_read on public.workspaces for select to authenticated
  using (private.is_workspace_member(id));
create policy workspace_rename on public.workspaces for update to authenticated
  using (private.is_workspace_owner(id)) with check (private.is_workspace_owner(id));
create policy workspace_members_read on public.workspace_members for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy quotes_read on public.quotes for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy quotes_insert on public.quotes for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy quotes_update on public.quotes for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy quote_photos_read on public.quote_photos for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy quote_photos_insert on public.quote_photos for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy quote_photos_update on public.quote_photos for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-photos', 'quote-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Metadata must exist before upload. Never trust the first path segment alone.
create function private.can_access_quote_photo(object_path text, include_deleted boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.quote_photos p
    join public.quotes q on q.id = p.quote_id and q.workspace_id = p.workspace_id
    join public.workspace_members m on m.workspace_id = p.workspace_id
    where p.storage_path = object_path and m.user_id = (select auth.uid())
      and (include_deleted or (p.deleted_at is null and q.deleted_at is null))
  );
$$;
revoke all on function private.can_access_quote_photo(text, boolean) from public, anon;
grant execute on function private.can_access_quote_photo(text, boolean) to authenticated;
-- Anonymous calls always return false; needed by restrictive guards if other buckets have public policies.
grant usage on schema private to anon;
grant execute on function private.can_access_quote_photo(text, boolean) to anon;

-- storage.objects already has RLS managed by Supabase. Leave its ownership/default grants intact.
create policy quote_photo_files_read on storage.objects for select to authenticated
  using (bucket_id = 'quote-photos' and private.can_access_quote_photo(name, true));
create policy quote_photo_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'quote-photos' and private.can_access_quote_photo(name));
create policy quote_photo_files_update on storage.objects for update to authenticated
  using (bucket_id = 'quote-photos' and private.can_access_quote_photo(name))
  with check (bucket_id = 'quote-photos' and private.can_access_quote_photo(name));
create policy quote_photo_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'quote-photos' and private.can_access_quote_photo(name, true));

-- Also constrain any pre-existing permissive policies, without changing access to other buckets.
create policy quote_photo_files_read_boundary on storage.objects as restrictive for select to public
  using (bucket_id <> 'quote-photos' or private.can_access_quote_photo(name, true));
create policy quote_photo_files_insert_boundary on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'quote-photos' or private.can_access_quote_photo(name));
create policy quote_photo_files_update_boundary on storage.objects as restrictive for update to public
  using (bucket_id <> 'quote-photos' or private.can_access_quote_photo(name))
  with check (bucket_id <> 'quote-photos' or private.can_access_quote_photo(name));
create policy quote_photo_files_delete_boundary on storage.objects as restrictive for delete to public
  using (bucket_id <> 'quote-photos' or private.can_access_quote_photo(name, true));

commit;
