-- Knowledge only. Uses the existing workspace membership and tenant identity guard.
begin;
create table public.knowledge_categories (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision integer not null check (revision > 0),
  schema_version integer not null check (schema_version = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'name') = 'string' and length(btrim(payload->>'name')) > 0
    and payload ? 'parentId' and (payload->'parentId' = 'null'::jsonb or jsonb_typeof(payload->'parentId') = 'string')),
  parent_id uuid generated always as ((payload->>'parentId')::uuid) stored,
  deleted_at timestamptz check (deleted_at is null), -- Categories currently have no delete operation.
  server_updated_at timestamptz not null default clock_timestamp(),
  unique (id, workspace_id),
  unique (id, parent_id, workspace_id),
  foreign key (parent_id, workspace_id) references public.knowledge_categories(id, workspace_id),
  check (parent_id is distinct from id)
);
create table public.knowledge_entries (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision integer not null check (revision > 0),
  schema_version integer not null check (schema_version = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'
    and payload ?& array['kind','categoryId','subcategoryId','name','notes','entryDate','supplier','shape','dimensions','carats','priceBasis','unitNetPrice','referenceWeight','fineness','goldColor','goldPricePerGram','materialCost','laborPrice','finishedPrice','archivedAt']
    and payload->>'kind' in ('stone','product') and payload->>'priceBasis' in ('carat','piece')
    and jsonb_typeof(payload->'name') = 'string' and length(btrim(payload->>'name')) > 0),
  category_id uuid generated always as ((payload->>'categoryId')::uuid) stored not null,
  subcategory_id uuid generated always as (nullif(payload->>'subcategoryId','')::uuid) stored,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  foreign key (category_id, workspace_id) references public.knowledge_categories(id, workspace_id),
  foreign key (subcategory_id, category_id, workspace_id) references public.knowledge_categories(id, parent_id, workspace_id)
);
create index knowledge_categories_changes_idx on public.knowledge_categories(workspace_id, server_updated_at, id);
create index knowledge_entries_changes_idx on public.knowledge_entries(workspace_id, server_updated_at, id);
create index knowledge_entries_category_idx on public.knowledge_entries(workspace_id, category_id, subcategory_id);

create function private.guard_knowledge_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.revision <> 1) or (tg_op = 'UPDATE' and new.revision <> old.revision + 1) then
    raise exception 'Knowledge revision must advance by one' using errcode = '23514';
  end if;
  if tg_table_name = 'knowledge_categories' then
    if tg_op = 'UPDATE' and new.payload->'parentId' is distinct from old.payload->'parentId' then
      raise exception 'Category parent is immutable' using errcode = '23514';
    end if;
    if new.payload->>'parentId' is not null and not exists (
      select 1 from public.knowledge_categories c where c.id = (new.payload->>'parentId')::uuid
        and c.workspace_id = new.workspace_id and c.parent_id is null
    ) then
      raise exception 'Category requires a root in the same workspace' using errcode = '23514';
    end if;
  else
    if not exists (select 1 from public.knowledge_categories c where c.id = (new.payload->>'categoryId')::uuid
      and c.workspace_id = new.workspace_id and c.parent_id is null) then
      raise exception 'Entry requires a root category in the same workspace' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_knowledge_record() from public, anon, authenticated;
create trigger knowledge_categories_identity before insert or update on public.knowledge_categories
  for each row execute function private.guard_cloud_record();
create trigger knowledge_entries_identity before insert or update on public.knowledge_entries
  for each row execute function private.guard_cloud_record();
create trigger knowledge_categories_validate before insert or update on public.knowledge_categories
  for each row execute function private.guard_knowledge_record();
create trigger knowledge_entries_validate before insert or update on public.knowledge_entries
  for each row execute function private.guard_knowledge_record();

alter table public.knowledge_categories enable row level security;
alter table public.knowledge_entries enable row level security;
revoke all on public.knowledge_categories, public.knowledge_entries from public, anon, authenticated;
-- Keep tombstones indefinitely so devices returning after a long offline period see deletions.
grant select, insert, update on public.knowledge_categories, public.knowledge_entries to authenticated;
create policy knowledge_categories_read on public.knowledge_categories for select to authenticated using (private.is_workspace_member(workspace_id));
create policy knowledge_categories_insert on public.knowledge_categories for insert to authenticated with check (private.is_workspace_member(workspace_id));
create policy knowledge_categories_update on public.knowledge_categories for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy knowledge_entries_read on public.knowledge_entries for select to authenticated using (private.is_workspace_member(workspace_id));
create policy knowledge_entries_insert on public.knowledge_entries for insert to authenticated with check (private.is_workspace_member(workspace_id));
create policy knowledge_entries_update on public.knowledge_entries for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
commit;
