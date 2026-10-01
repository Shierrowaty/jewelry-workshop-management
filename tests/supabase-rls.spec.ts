import { emptyKnowledgeDraft } from "../src/features/knowledge/types";
import { test, expect } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// Disposable PostgreSQL in process memory, NEVER the user's Supabase or IndexedDB.
let db: PGlite;
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const pathA = `${id(1)}/${id(201)}/${id(301)}.webp`;
const pathB = `${id(2)}/${id(202)}/${id(302)}.webp`;

test.beforeAll(async () => {
  db = new PGlite();
  // Minimal Supabase-managed schemas/roles. The project migration itself is executed verbatim.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  await db.exec(await readFile("supabase/migrations/20260904000100_cloud_foundation.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20260907000100_knowledge_sync.sql", "utf8"));
});
test.afterAll(async () => { await db?.close(); });

test.beforeEach(async () => {
  await db.exec(`
    truncate public.knowledge_entries, public.knowledge_categories, storage.objects, public.quote_photos, public.quotes, public.workspace_members, public.workspaces, auth.users;
    insert into auth.users(id) values (${[101, 102, 103, 104, 105].map(n => `'${id(n)}'`).join("),( ")});
    insert into public.workspaces(id,name) values ('${id(1)}','A'), ('${id(2)}','B');
    insert into public.workspace_members(workspace_id,user_id,role) values
      ('${id(1)}','${id(101)}','owner'), ('${id(1)}','${id(102)}','member'),
      ('${id(2)}','${id(103)}','owner'), ('${id(1)}','${id(105)}','member'), ('${id(2)}','${id(105)}','member');
    insert into public.quotes(id,workspace_id,created_at,updated_at,status,revision,schema_version,calculation_version,snapshot)
    values ('${id(201)}','${id(1)}','2025-01-01','2025-02-01','Wycena',1,2,1,'{"gold":{"purchasePerGram":"350"}}'),
           ('${id(202)}','${id(2)}','2025-01-01','2025-02-01','Wycena',1,2,1,'{}');
    insert into public.quote_photos(id,quote_id,workspace_id,created_at,updated_at,revision,schema_version,file_name,original_file_name,mime_type,size,width,height,storage_path)
    values ('${id(301)}','${id(201)}','${id(1)}','2025-01-01','2025-02-01',1,1,'a.webp','a.jpg','image/webp',100,100,100,'${pathA}'),
           ('${id(302)}','${id(202)}','${id(2)}','2025-01-01','2025-02-01',1,1,'b.webp','b.jpg','image/webp',100,100,100,'${pathB}');
    insert into storage.objects(bucket_id,name) values ('quote-photos','${pathA}'), ('quote-photos','${pathB}');
  `);
});

async function asUser(user: number | null, sql: string, params: unknown[] = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${user === null ? "anon" : "authenticated"}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user === null ? "" : id(user)]);
    return tx.query(sql, params);
  });
}

test("migracja włącza RLS, prywatny bucket i nie generuje nowych UUID wycen", async () => {
  const flags = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid in ('public.workspaces'::regclass,'public.workspace_members'::regclass,'public.quotes'::regclass,'public.quote_photos'::regclass)");
  expect(flags.rows).toHaveLength(4);
  expect(flags.rows.every(row => row.relrowsecurity)).toBe(true);
  expect((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='quote-photos'")).rows[0]).toMatchObject({ public: false, file_size_limit: 2097152, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] });
  expect((await db.query("select column_default from information_schema.columns where table_schema='public' and table_name in ('quotes','quote_photos') and column_name='id'")).rows).toEqual([{ column_default: null }, { column_default: null }]);
});

test("anon oraz zalogowany użytkownik bez członkostwa nie odczytują danych", async () => {
  for (const table of ["workspaces", "workspace_members", "quotes", "quote_photos"]) {
    await expect(asUser(null, `select * from public.${table}`)).rejects.toMatchObject({ code: "42501" });
    expect((await asUser(104, `select * from public.${table}`)).rows).toEqual([]);
  }
  expect((await asUser(null, "select * from storage.objects")).rows).toEqual([]);
});

test("dwaj członkowie widzą wspólne dane, a inny workspace pozostaje niewidoczny", async () => {
  for (const user of [101, 102]) {
    expect((await asUser(user, "select id from public.workspaces")).rows).toEqual([{ id: id(1) }]);
    expect((await asUser(user, "select id from public.quotes")).rows).toEqual([{ id: id(201) }]);
    expect((await asUser(user, "select id from public.quote_photos")).rows).toEqual([{ id: id(301) }]);
    expect((await asUser(user, "select * from public.workspace_members")).rows).toHaveLength(3);
  }
  expect((await asUser(103, "select id from public.quotes")).rows).toEqual([{ id: id(202) }]);
});

test("członek zapisuje i aktualizuje wycenę tylko w swoim workspace", async () => {
  const sql = "insert into public.quotes(id,workspace_id,created_at,updated_at,status,revision,schema_version,calculation_version,snapshot) values($1,$2,'2020-01-01','2020-02-01','Wycena',1,2,1,'{}') returning id";
  expect((await asUser(102, sql, [id(203), id(1)])).rows).toEqual([{ id: id(203) }]);
  await expect(asUser(103, sql, [id(204), id(1)])).rejects.toMatchObject({ code: "42501" });
  await expect(asUser(104, sql, [id(204), id(1)])).rejects.toMatchObject({ code: "42501" });
  expect((await asUser(103, "update public.quotes set notes='atak' where id=$1 returning id", [id(201)])).rows).toEqual([]);
  expect((await asUser(102, "update public.quotes set notes='ustalenia',revision=2 where id=$1 returning notes,revision", [id(201)])).rows).toEqual([{ notes: "ustalenia", revision: 2 }]);
  await expect(asUser(103, sql.replace(" returning id", " on conflict(id) do update set notes='nadpisanie' returning id"), [id(201), id(1)])).rejects.toMatchObject({ code: "42501" });
});

test("użytkownik nie może dopisać członkostwa ani nadać sobie owner", async () => {
  await expect(asUser(104, "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [id(1), id(104)])).rejects.toMatchObject({ code: "42501" });
  await expect(asUser(102, "update public.workspace_members set role='owner' where user_id=$1", [id(102)])).rejects.toMatchObject({ code: "42501" });
  await expect(asUser(101, "delete from public.workspace_members where user_id=$1", [id(102)])).rejects.toMatchObject({ code: "42501" });
  expect((await asUser(102, "update public.workspaces set name='zmiana' returning id")).rows).toEqual([]);
  expect((await asUser(101, "update public.workspaces set name='Pracownia' returning name")).rows).toEqual([{ name: "Pracownia" }]);
});

test("nie można przenieść istniejącego rekordu do innego workspace ani zmienić jego tożsamości", async () => {
  await expect(asUser(105, "update public.quotes set workspace_id=$1 where id=$2", [id(2), id(201)])).rejects.toMatchObject({ code: "23514" });
  await expect(asUser(102, "update public.quotes set created_at='2030-01-01' where id=$1", [id(201)])).rejects.toMatchObject({ code: "23514" });
  await expect(asUser(102, "update public.quotes set id=$1 where id=$2", [id(290), id(201)])).rejects.toMatchObject({ code: "23514" });
  await expect(asUser(105, "update public.quote_photos set quote_id=$1 where id=$2", [id(202), id(301)])).rejects.toMatchObject({ code: "23514" });
});

test("metadane zdjęcia wymagają wyceny z tego samego workspace i właściwej ścieżki", async () => {
  const insert = "insert into public.quote_photos(id,quote_id,workspace_id,created_at,updated_at,revision,schema_version,file_name,original_file_name,mime_type,size,width,height,storage_path) values($1,$2,$3,now(),now(),1,1,'c.webp','c.jpg','image/webp',100,100,100,$4) returning id";
  const ownPath = `${id(1)}/${id(201)}/${id(303)}.webp`;
  expect((await asUser(102, insert, [id(303), id(201), id(1), ownPath])).rows).toEqual([{ id: id(303) }]);
  await expect(asUser(105, insert, [id(304), id(202), id(1), `${id(1)}/${id(202)}/${id(304)}.webp`])).rejects.toMatchObject({ code: "23503" });
  await expect(asUser(103, insert, [id(304), id(201), id(1), `${id(1)}/${id(201)}/${id(304)}.webp`])).rejects.toMatchObject({ code: "42501" });
  await expect(asUser(102, insert, [id(304), id(201), id(1), "../obce.webp"])).rejects.toMatchObject({ code: "23514" });
});

test("soft delete pozostawia znacznik; trwałe kasowanie wycen i metadanych jest zabronione", async () => {
  expect((await asUser(102, "update public.quotes set deleted_at=now(),revision=2 where id=$1 returning id", [id(201)])).rows).toHaveLength(1);
  expect((await asUser(102, "select id from public.quotes where deleted_at is not null")).rows).toEqual([{ id: id(201) }]);
  for (const table of ["quotes", "quote_photos"]) await expect(asUser(101, `delete from public.${table}`)).rejects.toMatchObject({ code: "42501" });
});

test("serwer nadaje znacznik zmian, zachowując lokalną datę oraz snapshot", async () => {
  const result = await asUser(102, "update public.quotes set server_updated_at='2099-01-01T00:00:00Z',updated_at='2024-01-01T00:00:00Z',revision=2 where id=$1 returning server_updated_at,updated_at,snapshot", [id(201)]);
  const row = result.rows[0] as { server_updated_at: Date; updated_at: Date; snapshot: unknown };
  expect(new Date(row.server_updated_at).getUTCFullYear()).not.toBe(2099);
  expect(new Date(row.updated_at).toISOString()).toBe("2024-01-01T00:00:00.000Z");
  expect(row.snapshot).toEqual({ gold: { purchasePerGram: "350" } });
});

test("warunkowy UPDATE B1 dopuszcza tylko pierwszy zapis od wspólnej wersji bazowej", async () => {
  const original = (await asUser(102, "select revision,server_updated_at::text as stamp from public.quotes where id=$1", [id(201)])).rows[0] as { revision: number; stamp: string };
  const statement = "update public.quotes set revision=revision+1,notes=$1 where id=$2 and workspace_id=$3 and revision=$4 and server_updated_at=$5::timestamptz returning revision,notes";
  const args = [id(201), id(1), original.revision, original.stamp];
  expect((await asUser(101, statement, ["Pierwszy właściciel", ...args])).rows).toEqual([{ revision: 2, notes: "Pierwszy właściciel" }]);
  expect((await asUser(102, statement, ["Drugi właściciel", ...args])).rows).toEqual([]);
  expect((await asUser(102, "select notes from public.quotes where id=$1", [id(201)])).rows).toEqual([{ notes: "Pierwszy właściciel" }]);
});

test("Storage pozwala na odczyt, zapis i usunięcie tylko poprawnie powiązanego pliku", async () => {
  expect((await asUser(102, "select name from storage.objects")).rows).toEqual([{ name: pathA }]);
  expect((await asUser(103, "select name from storage.objects")).rows).toEqual([{ name: pathB }]);
  expect((await asUser(104, "select name from storage.objects")).rows).toEqual([]);
  expect((await asUser(102, "delete from storage.objects where name=$1 returning name", [pathB])).rows).toEqual([]);
  expect((await asUser(102, "delete from storage.objects where name=$1 returning name", [pathA])).rows).toEqual([{ name: pathA }]);
  expect((await asUser(102, "insert into storage.objects(bucket_id,name) values('quote-photos',$1) returning name", [pathA])).rows).toEqual([{ name: pathA }]);
  await expect(asUser(103, "insert into storage.objects(bucket_id,name) values('quote-photos',$1)", [pathA])).rejects.toMatchObject({ code: "42501" });
  await expect(asUser(102, "insert into storage.objects(bucket_id,name) values('quote-photos',$1)", [`${id(1)}/dowolny.webp`])).rejects.toMatchObject({ code: "42501" });
  await expect(asUser(102, "update storage.objects set name=$1 where name=$2", [pathB, pathA])).rejects.toMatchObject({ code: "42501" });
});

test("po soft delete można usunąć plik, ale nie można ponownie go przesłać", async () => {
  await asUser(102, "update public.quote_photos set deleted_at=now(),revision=2 where id=$1", [id(301)]);
  expect((await asUser(102, "delete from storage.objects where name=$1 returning name", [pathA])).rows).toEqual([{ name: pathA }]);
  await expect(asUser(102, "insert into storage.objects(bucket_id,name) values('quote-photos',$1)", [pathA])).rejects.toMatchObject({ code: "42501" });
});

test("dawna szeroka polityka innego bucketa nie otwiera dostępu do quote-photos", async () => {
  // Deliberately hostile pre-existing policy in the test DB, not in the project migration.
  await db.exec("create policy legacy_open_test on storage.objects for all to public using (true) with check (true)");
  try {
    expect((await asUser(null, "select name from storage.objects")).rows).toEqual([]);
    expect((await asUser(104, "select name from storage.objects")).rows).toEqual([]);
    expect((await asUser(103, "select name from storage.objects")).rows).toEqual([{ name: pathB }]);
    await expect(asUser(104, "insert into storage.objects(bucket_id,name) values('quote-photos',$1)", [pathA])).rejects.toMatchObject({ code: "42501" });
  } finally { await db.exec("drop policy legacy_open_test on storage.objects"); }
});

const knowledgeInsert = (table: string) => `insert into public.${table}(id,workspace_id,created_at,updated_at,revision,schema_version,payload) values($1,$2,'2020-01-01','2020-02-01',1,1,$3::jsonb) returning id`;
async function knowledgeFixtures() {
  for (const [root,workspace,user] of [[401,1,101],[402,2,103]]) await asUser(user, knowledgeInsert("knowledge_categories"), [id(root),id(workspace),JSON.stringify({name:"Ręczna",parentId:null})]);
  await asUser(101, knowledgeInsert("knowledge_categories"), [id(403),id(1),JSON.stringify({name:"Podkategoria",parentId:id(401)})]);
  for (const [entry,root,workspace,user] of [[501,401,1,101],[502,402,2,103]]) await asUser(user, knowledgeInsert("knowledge_entries"), [id(entry),id(workspace),JSON.stringify({...emptyKnowledgeDraft("2020-02-29"),name:"Szmaragd",categoryId:id(root),archivedAt:null})]);
}
test("Baza wiedzy: RLS współdzieli kategorie i wpisy tylko w obrębie pracowni", async () => {
  await knowledgeFixtures();
  const flags = await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where oid in ('public.knowledge_categories'::regclass,'public.knowledge_entries'::regclass)");
  expect(flags.rows).toEqual([{relrowsecurity:true},{relrowsecurity:true}]);
  for (const table of ["knowledge_categories","knowledge_entries"]) {
    await expect(asUser(null,`select * from public.${table}`)).rejects.toMatchObject({code:"42501"});
    expect((await asUser(104,`select * from public.${table}`)).rows).toEqual([]);
    expect((await asUser(101,`select * from public.${table} order by id`)).rows).toEqual((await asUser(102,`select * from public.${table} order by id`)).rows);
    expect((await asUser(103,`select workspace_id from public.${table}`)).rows).toEqual([{workspace_id:id(2)}]);
  }
  expect((await asUser(102,"select id from public.knowledge_entries")).rows).toEqual([{id:id(501)}]);
  await expect(asUser(103,knowledgeInsert("knowledge_entries"),[id(503),id(1),JSON.stringify({...emptyKnowledgeDraft("2020-02-29"),name:"Obcy",categoryId:id(401),archivedAt:null})])).rejects.toBeTruthy();
  expect((await asUser(103,"update public.knowledge_entries set revision=2 where id=$1 returning id",[id(501)])).rows).toEqual([]);
});
test("Baza wiedzy: członek edytuje, archiwizuje i usuwa przez tombstone; CAS i tożsamość chronione", async () => {
  await knowledgeFixtures();
  const before = (await asUser(102,"select server_updated_at::text from public.knowledge_entries where id=$1",[id(501)])).rows[0] as {server_updated_at:string};
  expect((await asUser(102,"update public.knowledge_entries set payload=jsonb_set(payload,'{archivedAt}',to_jsonb('2020-03-01T00:00:00Z'::text)),revision=2 where id=$1 and revision=1 returning revision",[id(501)])).rows).toEqual([{revision:2}]);
  expect((await asUser(102,"update public.knowledge_entries set revision=2 where id=$1 and revision=1 returning id",[id(501)])).rows).toEqual([]);
  await expect(asUser(102,"update public.knowledge_entries set revision=2 where id=$1",[id(501)])).rejects.toMatchObject({code:"23514"});
  await expect(asUser(105,"update public.knowledge_entries set workspace_id=$1,revision=3 where id=$2",[id(2),id(501)])).rejects.toMatchObject({code:"23514"});
  await expect(asUser(102,"delete from public.knowledge_entries where id=$1",[id(501)])).rejects.toMatchObject({code:"42501"});
  await asUser(102,"update public.knowledge_entries set deleted_at='2020-04-01',revision=3 where id=$1",[id(501)]);
  const after = (await asUser(101,"select deleted_at::text,server_updated_at::text,revision from public.knowledge_entries where id=$1",[id(501)])).rows[0] as {deleted_at:string;server_updated_at:string;revision:number};
  expect(after.deleted_at).toBeTruthy(); expect(after.revision).toBe(3); expect(after.server_updated_at).not.toEqual(before.server_updated_at);
});
test("Baza wiedzy: klucze obce pilnują pracowni oraz dwóch poziomów kategorii", async () => {
  await knowledgeFixtures();
  await expect(asUser(105,knowledgeInsert("knowledge_categories"),[id(404),id(1),JSON.stringify({name:"Obcy rodzic",parentId:id(402)})])).rejects.toMatchObject({code:"23514"});
  await expect(asUser(102,knowledgeInsert("knowledge_categories"),[id(404),id(1),JSON.stringify({name:"Trzeci poziom",parentId:id(403)})])).rejects.toMatchObject({code:"23514"});
  const entry = {...emptyKnowledgeDraft("2020-02-29"),name:"Referencja",categoryId:id(401),subcategoryId:id(402),archivedAt:null};
  await expect(asUser(105,knowledgeInsert("knowledge_entries"),[id(503),id(1),JSON.stringify(entry)])).rejects.toMatchObject({code:"23503"});
  entry.subcategoryId=id(403); expect((await asUser(102,knowledgeInsert("knowledge_entries"),[id(503),id(1),JSON.stringify(entry)])).rows).toEqual([{id:id(503)}]);
  await expect(asUser(102,"update public.knowledge_categories set payload=jsonb_set(payload,'{parentId}',to_jsonb($1::text)),revision=2 where id=$2",[id(403),id(401)])).rejects.toMatchObject({code:"23514"});
});
