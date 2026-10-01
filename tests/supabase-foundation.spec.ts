import { SupabaseKnowledgeRepository } from "../src/features/knowledge/sync/remote";
import { toCloud } from "../src/features/knowledge/sync/mapping";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getSupabaseConfig } from "../src/lib/supabase/config";
import { SupabaseQuoteRepository, nextChangeCursor } from "../src/lib/supabase/cloud-repository";
import { photoStoragePath, photoToCloud, quoteToCloud } from "../src/lib/supabase/mappers";
import type { Database } from "../src/lib/supabase/database.types";
import type { SavedQuote } from "../src/features/quotes/data/types";
import type { ActiveQuotePhoto } from "../src/features/quotes/photos/types";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { exampleCatalog } from "../src/features/quotes/catalog";
import { snapshotFromDraft } from "../src/features/quotes/data/snapshot";
import { getUser, signIn, signOut } from "../src/lib/supabase/auth";
import { getUserWorkspace } from "../src/lib/supabase/workspace";

const workspace = "10000000-0000-4000-8000-000000000001";
const otherWorkspace = "10000000-0000-4000-8000-000000000002";
const quoteId = "20000000-0000-4000-8000-000000000001";
const photoId = "30000000-0000-4000-8000-000000000001";
const time = "2026-09-04T12:00:00.000Z";
const testKey = "sb_publishable_unit_test_placeholder";

function sampleQuote(): SavedQuote {
  const draft = createEmptyQuote("2026-09-04");
  draft.product.weight = "5,5"; draft.gold.purchasePerGram = "350";
  return { id: quoteId, createdAt: time, updatedAt: time, completedAt: null, revision: 3, syncStatus: "pending", schemaVersion: 2, calculationVersion: 1, ...snapshotFromDraft(draft, exampleCatalog)! };
}
function samplePhoto(): ActiveQuotePhoto {
  return { id: photoId, quoteId, createdAt: time, updatedAt: time, revision: 2, schemaVersion: 1, syncStatus: "pending", deletedAt: null, fileName: "detal.webp", originalFileName: "detal.jpg", mimeType: "image/webp", size: 4, width: 100, height: 100, blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" }) };
}
function transport() {
  const requests: { url: URL; method: string; body: BodyInit | null | undefined }[] = [];
  let response: unknown = [];
  let status = 200;
  const client = createClient<Database>("https://example.supabase.co", testKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      requests.push({ url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? "GET", body: init?.body });
      return response instanceof Blob ? new Response(response) : new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
    } },
  });
  return { client, requests, repository: new SupabaseQuoteRepository(client, workspace), respond: (value: unknown, code = 200) => { response = value; status = code; } };
}

test("brak env ma czytelny błąd dopiero przy jawnym użyciu konfiguracji", () => {
  expect(() => getSupabaseConfig({})).toThrow("Lokalna aplikacja może działać bez nich");
  expect(() => getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" })).toThrow("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  expect(getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: testKey })).toEqual({ url: "https://example.supabase.co", publishableKey: testKey });
});

test("konfiguracja odrzuca prywatny klucz, stare JWT i niebezpieczny URL", () => {
  for (const key of [["sb", "secret", "placeholder_not_a_real_key"].join("_"), ["eyJhbGciOiJIUzI1NiJ9", "test", "test"].join("."), "service_role"]) {
    expect(() => getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })).toThrow("publicznego klucza");
  }
  for (const url of ["http://example.com", "https://user:password@example.com", "https://example.com/path", "not a URL"]) {
    expect(() => getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: testKey })).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  }
});

test("mapowanie zachowuje globalne ID, rewizję i ceny snapshotu bez zmiany pending", () => {
  const local = sampleQuote();
  const original = structuredClone(local);
  const row = quoteToCloud(local, workspace);
  expect(row).toMatchObject({ id: quoteId, workspace_id: workspace, created_at: time, updated_at: time, revision: 3, due_date: null, deleted_at: null, schema_version: 2, calculation_version: 1 });
  expect(row.snapshot).toEqual(local.snapshot);
  expect(row.snapshot).not.toBe(local.snapshot);
  expect(row.snapshot).toMatchObject({ gold: { mass: "5,5", purchasePerGram: "350" } });
  expect(row).not.toHaveProperty("syncStatus");
  expect(row).not.toHaveProperty("server_updated_at");
  expect(local).toEqual(original);
});

test("mapowanie zdjęć usuwa Blob z payloadu i zachowuje tombstone", () => {
  const photo = samplePhoto();
  const row = photoToCloud(photo, workspace);
  expect(row).toMatchObject({ id: photoId, quote_id: quoteId, storage_path: `${workspace}/${quoteId}/${photoId}.webp`, mime_type: "image/webp", size: 4 });
  expect(row).not.toHaveProperty("blob");
  expect(row).not.toHaveProperty("syncStatus");
  expect(photoToCloud({ ...photo, deletedAt: time, blob: null }, workspace).deleted_at).toBe(time);
  expect(photoStoragePath(workspace, quoteId, photoId, "image/jpeg")).toMatch(/\.jpg$/);
  expect(photoStoragePath(workspace, quoteId, photoId, "image/png")).toMatch(/\.png$/);
  expect(() => photoStoragePath("../bad", quoteId, photoId, "image/webp")).toThrow("UUID");
});

test("repozytorium nie wysyła nic przy tworzeniu, upsert wykonuje dopiero jawne wywołanie", async () => {
  const ctx = transport();
  expect(ctx.requests).toEqual([]);
  const row = quoteToCloud(sampleQuote(), workspace);
  ctx.respond({ ...row, server_updated_at: time });
  await ctx.repository.upsertQuote(row);
  expect(ctx.requests).toHaveLength(1);
  expect(ctx.requests[0].url.pathname).toBe("/rest/v1/quotes");
  expect(JSON.parse(ctx.requests[0].body as string)).toEqual(row);
  await expect(ctx.repository.upsertQuote({ ...row, workspace_id: otherWorkspace })).rejects.toThrow("innego workspace");
  expect(ctx.requests).toHaveLength(1);
});

test("odczyt zmian uwzględnia workspace, remis czasu i tombstones bez zaokrąglania mikrosekund", async () => {
  const ctx = transport();
  const cursor = { serverUpdatedAt: "2026-09-04T12:00:00.123456+00:00", id: quoteId };
  const rows = [{ ...quoteToCloud(sampleQuote(), workspace), deleted_at: time, server_updated_at: cursor.serverUpdatedAt }];
  ctx.respond(rows);
  expect(await ctx.repository.fetchChangedQuotes(cursor, 10)).toEqual(rows);
  const params = ctx.requests[0].url.searchParams;
  expect(params.get("workspace_id")).toBe(`eq.${workspace}`);
  expect(params.get("order")).toBe("server_updated_at.asc,id.asc");
  expect(params.get("or")).toContain(".123456+00:00");
  expect(params.get("or")).toContain(`id.gt.${quoteId}`);
  expect(params.has("deleted_at")).toBe(false);
  expect(nextChangeCursor(rows)).toEqual(cursor);
  await expect(ctx.repository.fetchChangedQuotes({ ...cursor, serverUpdatedAt: "x),workspace_id.eq.other" })).rejects.toThrow("znacznik czasu");
  await expect(ctx.repository.fetchChangedQuotes(undefined, 501)).rejects.toThrow("Rozmiar strony");
});

test("metadane, Storage i soft delete wymagają odrębnych wywołań i nie czyszczą lokalnego zdjęcia", async () => {
  const ctx = transport();
  const local = samplePhoto();
  const row = photoToCloud(local, workspace);
  ctx.respond(row);
  await ctx.repository.upsertPhotoMetadata(row);
  expect(ctx.requests[0].url.pathname).toBe("/rest/v1/quote_photos");
  expect(ctx.requests).toHaveLength(1);
  ctx.respond({ Key: row.storage_path });
  await ctx.repository.uploadPhoto(row, local.blob);
  expect(ctx.requests[1].url.pathname).toBe(`/storage/v1/object/quote-photos/${row.storage_path}`);
  ctx.respond(local.blob);
  expect((await ctx.repository.downloadPhoto(row)).size).toBe(4);
  ctx.respond({ ...row, deleted_at: time, revision: 3 });
  await ctx.repository.softDeletePhotoMetadata(photoId, { updatedAt: time, revision: 3 });
  expect(JSON.parse(ctx.requests[3].body as string)).toEqual({ updated_at: time, deleted_at: time, revision: 3 });
  expect(ctx.requests[3].url.searchParams.get("workspace_id")).toBe(`eq.${workspace}`);
  expect(ctx.requests[3].method).toBe("PATCH");
  expect(local.blob.size).toBe(4);
  expect(local.syncStatus).toBe("pending");
  await expect(ctx.repository.uploadPhoto({ ...row, storage_path: "../other.webp" }, local.blob)).rejects.toThrow("Ścieżka Storage");
  await expect(ctx.repository.uploadPhoto(row, new Blob(["wrong"], { type: "image/jpeg" }))).rejects.toThrow("Plik nie odpowiada");
});

test("błędy Supabase pozostają błędami; nie ma fałszywego potwierdzenia zapisu", async () => {
  const ctx = transport();
  ctx.respond({ code: "42501", message: "RLS denied", details: null, hint: null }, 403);
  await expect(ctx.repository.upsertQuote(quoteToCloud(sampleQuote(), workspace))).rejects.toMatchObject({ code: "42501" });
});

test("B1 używa INSERT dla nowego UUID i warunkowego UPDATE dla znanej wersji", async () => {
  const ctx = transport(), row = quoteToCloud(sampleQuote(), workspace);
  ctx.respond({ ...row, server_updated_at: time });
  await ctx.repository.saveQuoteConditionally(row, null);
  expect(ctx.requests[0].method).toBe("POST");
  expect(ctx.requests[0].url.searchParams.has("on_conflict")).toBe(false);
  await ctx.repository.saveQuoteConditionally({ ...row, revision: 4 }, { revision: 3, serverUpdatedAt: time });
  expect(ctx.requests[1].method).toBe("PATCH");
  expect(ctx.requests[1].url.searchParams.get("workspace_id")).toBe(`eq.${workspace}`);
  expect(ctx.requests[1].url.searchParams.get("revision")).toBe("eq.3");
  expect(ctx.requests[1].url.searchParams.get("server_updated_at")).toBe(`eq.${time}`);
  ctx.respond(null);
  expect(await ctx.repository.saveQuoteConditionally({ ...row, revision: 4 }, { revision: 3, serverUpdatedAt: time })).toBeNull();
  ctx.respond({ code: "23505", message: "UUID exists" }, 409);
  expect(await ctx.repository.saveQuoteConditionally(row, null)).toBeNull();
});

test("odczyt pojedynczej wyceny i zapis CAS pozostają w zadanym workspace", async () => {
  const ctx = transport();
  ctx.respond([]);
  expect(await ctx.repository.getQuote(quoteId)).toBeNull();
  expect(ctx.requests[0].url.searchParams.get("id")).toBe(`eq.${quoteId}`);
  expect(ctx.requests[0].url.searchParams.get("workspace_id")).toBe(`eq.${workspace}`);
  await expect(ctx.repository.saveQuoteConditionally(quoteToCloud(sampleQuote(), otherWorkspace), null)).rejects.toThrow("innego workspace");
  expect(ctx.requests).toHaveLength(1);
});

test("workspace bez członkostwa lub z wieloma członkostwami nie jest wybierany automatycznie", async () => {
  const ctx = transport();
  ctx.respond([]);
  await expect(getUserWorkspace(ctx.client, quoteId)).rejects.toThrow("żadnej pracowni");
  expect(ctx.requests[0].url.searchParams.get("user_id")).toBe(`eq.${quoteId}`);
  ctx.respond([{ workspace_id: workspace }, { workspace_id: otherWorkspace }]);
  await expect(getUserWorkspace(ctx.client, quoteId)).rejects.toThrow("więcej niż jednej");
});

test("Auth jest jawne, odrzuca złe dane logowania i nie wymaga sesji do lokalnej pracy", async () => {
  const ctx = transport();
  expect(await getUser(ctx.client)).toBeNull();
  expect(ctx.requests).toHaveLength(0);
  ctx.respond({ error_code: "invalid_credentials", msg: "Invalid credentials" }, 400);
  await expect(signIn(ctx.client, " user@example.invalid ", "dummy-test-password")).rejects.toBeDefined();
  expect(ctx.requests[0].url.pathname).toBe("/auth/v1/token");
  expect(JSON.parse(ctx.requests[0].body as string).email).toBe("user@example.invalid");
  await signOut(ctx.client);
});

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sourceFiles(join(root, entry.name)) : [join(root, entry.name)]))).flat();
}

test("formularz, lokalne repozytoria i zdjęcia nie zapisują do Supabase; konfiguracja pozostaje poza źródłami", async () => {
  const rootFiles = (await readdir(".", { withFileTypes: true })).filter(entry => entry.isFile() && /\.(?:md|json|ts|mjs)$/.test(entry.name)).map(entry => entry.name);
  const files = [...await sourceFiles("src"), ...await sourceFiles("docs"), ...await sourceFiles("supabase"), ...await sourceFiles("tests"), ...rootFiles];
  const env = await readFile(".env.local", "utf8").catch(() => "");
  const actualValues = env.split(/\r?\n/).filter(line => line.startsWith("NEXT_PUBLIC_SUPABASE_")).map(line => line.slice(line.indexOf("=") + 1)).filter(Boolean);
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const value of actualValues) expect(contents.includes(value), `Konfiguracja poza .env.local: ${file}`).toBe(false);
    expect(contents, file).not.toMatch(/sb_secret_[A-Za-z0-9_-]{15,}/);
    for (const token of contents.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      expect(payload.role, file).not.toBe("service_role");
    }
    if (/^src[\\/]features[\\/]quotes[\\/].*\.tsx?$/.test(file)) expect(contents, file).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*supabase/);
  }
  expect(await readFile(".gitignore", "utf8")).toMatch(/^\.env\*/m);
});


test("B2 metadata INSERT/CAS oraz odczyt są ograniczone do workspace", async () => {
  const ctx=transport(), row=photoToCloud(samplePhoto(),workspace);
  ctx.respond({...row,server_updated_at:time}); await ctx.repository.savePhotoConditionally(row,null);
  expect(ctx.requests[0].method).toBe("POST"); expect(ctx.requests[0].url.searchParams.has("on_conflict")).toBe(false);
  await ctx.repository.savePhotoConditionally({...row,revision:3},{revision:2,serverUpdatedAt:time});
  expect(ctx.requests[1].method).toBe("PATCH"); expect(ctx.requests[1].url.searchParams.get("revision")).toBe("eq.2");
  expect(ctx.requests[1].url.searchParams.get("server_updated_at")).toBe(`eq.${time}`);
  await ctx.repository.getPhotoMetadata(photoId); expect(ctx.requests[2].url.searchParams.get("workspace_id")).toBe(`eq.${workspace}`);
  ctx.respond({code:"23505"},409); expect(await ctx.repository.savePhotoConditionally(row,null)).toBeNull();
  await expect(ctx.repository.savePhotoConditionally({...row,workspace_id:otherWorkspace},null)).rejects.toThrow("innego workspace");
});

test("Baza wiedzy: transport zachowuje workspace, mikrosekundy i CAS bez upsertu", async () => {
  const t = transport(), repository = new SupabaseKnowledgeRepository(t.client, workspace);
  const row = toCloud({id:quoteId,name:"Kamienie",parentId:null,createdAt:time},workspace);
  expect(t.requests).toHaveLength(0);
  await repository.fetch("knowledge_categories",{id:quoteId,serverUpdatedAt:"2026-09-07T12:00:00.123456Z"});
  expect(t.requests[0].url.searchParams.get("workspace_id")).toBe(`eq.${workspace}`);
  expect(t.requests[0].url.searchParams.get("or")).toContain("2026-09-07T12:00:00.123456Z");
  expect(t.requests[0].url.searchParams.get("limit")).toBe("100");
  t.respond({...row,server_updated_at:time});await repository.save("knowledge_categories",row,null);
  expect(t.requests[1].method).toBe("POST");expect(t.requests[1].url.searchParams.has("on_conflict")).toBe(false);
  t.respond(null);expect(await repository.save("knowledge_categories",{...row,revision:2},{revision:1,serverUpdatedAt:"2026-09-07T12:00:00.123456Z"})).toBeNull();
  expect(t.requests[2].method).toBe("PATCH");expect(t.requests[2].url.searchParams.get("revision")).toBe("eq.1");expect(t.requests[2].url.searchParams.get("server_updated_at")).toBe("eq.2026-09-07T12:00:00.123456Z");
  await expect(repository.save("knowledge_categories",{...row,workspace_id:otherWorkspace},null)).rejects.toThrow("pracownia");
  expect(t.requests).toHaveLength(3);
});
test("Baza wiedzy: odmowa dostępu i brak tabel nie są potwierdzeniem synchronizacji", async () => {
  const t=transport(),repository=new SupabaseKnowledgeRepository(t.client,workspace);
  t.respond({code:"42501",message:"denied"},403);await expect(repository.fetch("knowledge_entries")).rejects.toMatchObject({code:"42501"});
  t.respond({code:"PGRST205",message:"missing table"},404);await expect(repository.fetch("knowledge_categories")).rejects.toMatchObject({code:"PGRST205"});
  const row=toCloud({id:quoteId,name:"Kamienie",parentId:null,createdAt:time},workspace);
  t.respond({code:"23505",message:"duplicate"},409);expect(await repository.save("knowledge_categories",row,null)).toBeNull();
});
