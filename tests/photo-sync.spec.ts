import { expect, test } from "@playwright/test";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { LocalQuoteRepository } from "../src/features/quotes/data/quote-repository";
import { LocalQuotePhotoRepository } from "../src/features/quotes/photos/photo-repository";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { exampleCatalog } from "../src/features/quotes/catalog";
import { LocalSyncRepository } from "../src/features/sync/local-sync-repository";
import { LocalPhotoSyncRepository } from "../src/features/sync/photos/local-photo-sync-repository";
import { PhotoSyncEngine } from "../src/features/sync/photos/photo-sync-engine";
import { photoVersion, sameBytes } from "../src/features/sync/photos/validation";
import { sameVersion } from "../src/features/sync/quote-validation";
import { photoToCloud, quoteToCloud } from "../src/lib/supabase/mappers";
import type { CloudPhoto, CloudPhotoWrite, CloudQuote } from "../src/lib/supabase/database.types";
import type { ChangeCursor } from "../src/lib/supabase/cloud-repository";
import type { CloudVersion } from "../src/features/sync/types";
import type { PhotoSyncRemote } from "../src/features/sync/photos/types";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const scope = { projectUrl: "https://photos.example.invalid", workspaceId };
const workspace = { id: workspaceId, name: "Test" };
const databases: QuotesDatabase[] = [];
// Tiny PNG; node tests verify byte signatures, browser E2E additionally decodes dimensions.
const blob = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")], { type: "image/png" });
class Cloud implements PhotoSyncRemote {
  workspaceId = workspaceId;
  rows = new Map<string, CloudPhoto>(); objects = new Map<string, Blob>(); quotes = new Map<string, CloudQuote>();
  logs: string[] = []; uploads = 0; downloads = 0; deletes = 0; tick = 0;
  offline = false; failUpload = false; loseUpload = false; loseMetadata = false; failDelete = false;
  afterUpload?: () => Promise<void>; beforeSave?: () => Promise<void>; afterDownload?: () => Promise<void>;
  check() { if (this.offline) throw new Error("offline"); }
  stamp() { return new Date(Date.UTC(2026,8,5,12,0,++this.tick)).toISOString(); }
  put(row: CloudPhotoWrite) { const saved = { ...row, server_updated_at: this.stamp() }; this.rows.set(row.id,saved); return saved; }
  async getQuote(id: string) { this.check(); return this.quotes.get(id) ?? null; }
  async getPhotoMetadata(id: string) { this.check(); return structuredClone(this.rows.get(id) ?? null); }
  async fetchChangedPhotoMetadata(cursor?: ChangeCursor, limit = 100) {
    this.check(); return structuredClone([...this.rows.values()].sort((a,b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id))
      .filter(row => !cursor || row.server_updated_at > cursor.serverUpdatedAt || row.server_updated_at === cursor.serverUpdatedAt && row.id > cursor.id).slice(0,limit));
  }
  async savePhotoConditionally(row: CloudPhotoWrite, base: CloudVersion | null) {
    this.check(); await this.beforeSave?.();
    if (!this.quotes.has(row.quote_id)) throw new Error("FK");
    const current = this.rows.get(row.id);
    if (base ? !current || !sameVersion(base,photoVersion(current)) : current) return null;
    this.logs.push("metadata"); const saved = this.put(row);
    if (this.loseMetadata) { this.loseMetadata = false; throw new Error("Lost metadata response"); }
    return saved;
  }
  async uploadPhoto(row: CloudPhotoWrite, file: Blob) {
    this.check(); this.logs.push("upload");
    if (this.failUpload) throw new Error("Upload failed");
    if (this.objects.has(row.storage_path)) throw { statusCode: "409", message: "already exists" };
    if (!this.rows.has(row.id) || this.rows.get(row.id)?.deleted_at) throw new Error("Storage policy");
    this.objects.set(row.storage_path,file); this.uploads++; await this.afterUpload?.();
    if (this.loseUpload) { this.loseUpload = false; throw new Error("Lost upload response"); }
  }
  async downloadPhoto(row: CloudPhotoWrite) {
    this.check(); this.downloads++; const file = this.objects.get(row.storage_path);
    if (!file) throw new Error("Object not found");
    await this.afterDownload?.(); return file;
  }
  async removePhotoFile(row: CloudPhotoWrite) {
    this.check(); if (this.failDelete) throw new Error("Delete failed");
    expect(this.rows.get(row.id)?.deleted_at).toBeTruthy();
    this.logs.push("delete"); this.objects.delete(row.storage_path); this.deletes++;
  }
}
async function device() {
  const db = new QuotesDatabase(`photo-sync-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange }); databases.push(db);
  await new LocalSyncRepository(db).bind(scope.projectUrl,workspace);
  const photos = new LocalQuotePhotoRepository(db);
  const local = new LocalPhotoSyncRepository(db,scope);
  return { db, photos, local, run: (cloud: Cloud, check?: () => void, between?: () => Promise<void>) => new PhotoSyncEngine(local,cloud,check,between).run() };
}
async function setup() {
  const d = await device(), cloud = new Cloud();
  const quote = await new LocalQuoteRepository(d.db).create(createEmptyQuote("2026-09-05"),exampleCatalog);
  await d.db.quotes.update(quote.id,{syncStatus:"synced"});
  cloud.quotes.set(quote.id,{...quoteToCloud(quote,workspaceId),server_updated_at:cloud.stamp()});
  const photo = await d.photos.add(quote.id,{blob,fileName:"small.png",originalFileName:"small.png",width:1,height:1});
  return {d,cloud,quote,photo};
}
async function second(ctx: Awaited<ReturnType<typeof setup>>) {
  const b = await device(); await b.db.quotes.add({...ctx.quote,syncStatus:"synced"}); return b;
}
test.afterEach(() => databases.splice(0).forEach(db => db.close()));

test("B2: metadata przed Storage, te same UUID i bajty; kolejne sync bez pobierania", async () => {
  const {d,cloud,photo} = await setup(); await d.run(cloud);
  expect(cloud.logs).toEqual(["metadata","upload"]); expect(cloud.rows.size).toBe(1);
  expect(await sameBytes(cloud.objects.values().next().value!,blob)).toBe(true);
  expect(await d.db.quotePhotos.get(photo.id)).toEqual({...photo,syncStatus:"synced"});
  await d.run(cloud); await d.run(cloud); expect(cloud.uploads).toBe(1); expect(cloud.downloads).toBe(0);
});
for (const failure of ["failUpload", "loseUpload", "loseMetadata"] as const) test(`B2: ${failure}, restart IndexedDB i retry bez duplikacji`, async () => {
  const {d,cloud,photo} = await setup(); cloud[failure] = true;
  await expect(d.run(cloud)).rejects.toThrow(); expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("pending");
  expect(cloud.rows.size).toBe(1); expect(await d.db.photoSync.get(photo.id)).toBeDefined();
  d.db.close(); await d.db.open(); cloud[failure] = false; await d.run(cloud);
  expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("synced"); expect(cloud.rows.size).toBe(1); expect(cloud.objects.size).toBe(1); expect(cloud.uploads).toBe(1);
});
test("B2: drugie urządzenie pobiera Blob raz i zachowuje go po restarcie", async () => {
  const ctx = await setup(); await ctx.d.run(ctx.cloud); const b = await second(ctx);
  await b.run(ctx.cloud); expect(await b.db.quotePhotos.get(ctx.photo.id)).toEqual({...ctx.photo,syncStatus:"synced"});
  b.db.close(); await b.db.open(); await b.run(ctx.cloud); expect(ctx.cloud.downloads).toBe(1);
  expect(await sameBytes((await b.db.quotePhotos.get(ctx.photo.id))!.blob!,blob)).toBe(true);
});
test("B2: cloud metadata bez pliku nie tworzy pustej aktywnej fotografii; retry pobiera", async () => {
  const ctx = await setup(); ctx.cloud.failUpload = true; await expect(ctx.d.run(ctx.cloud)).rejects.toThrow();
  const b = await second(ctx); await expect(b.run(ctx.cloud)).rejects.toThrow(); expect(await b.photos.list(ctx.quote.id)).toHaveLength(0);
  expect((await b.db.photoSync.get(ctx.photo.id))?.phase).toBe("download");
  ctx.cloud.failUpload=false; await ctx.d.run(ctx.cloud); await b.run(ctx.cloud); expect(await b.photos.list(ctx.quote.id)).toHaveLength(1);
});
test("B2: lokalny delete, awaria Storage, restart i idempotentne usunięcie na drugim urządzeniu", async () => {
  const ctx = await setup(); const {d,cloud,photo,quote} = ctx; await d.run(cloud); const b = await second(ctx); await b.run(cloud);
  await d.photos.remove(quote.id,photo.id); cloud.failDelete=true; await expect(d.run(cloud)).rejects.toThrow();
  expect(cloud.rows.get(photo.id)?.deleted_at).toBeTruthy(); expect((await d.db.quotePhotos.get(photo.id))?.blob).toBeNull();
  d.db.close(); await d.db.open(); cloud.failDelete=false; await d.run(cloud); expect(cloud.objects.size).toBe(0);
  await b.run(cloud); await d.run(cloud); expect(await b.photos.list(quote.id)).toHaveLength(0); expect((await b.db.quotePhotos.get(photo.id))?.syncStatus).toBe("synced");
});
test("B2: plik już nie istnieje przy delete; późny upload jest sprzątany przez tombstone", async () => {
  const {d,cloud,photo,quote} = await setup(); await d.run(cloud); cloud.objects.clear();
  await d.photos.remove(quote.id,photo.id); await d.run(cloud); expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("synced");
  cloud.objects.set(cloud.rows.get(photo.id)!.storage_path,blob); await d.run(cloud); expect(cloud.objects.size).toBe(0);
});
test("B2: offline add/delete zachowuje zamiar, quote pending blokuje metadata i Storage", async () => {
  const {d,cloud,photo,quote} = await setup(); await d.db.quotes.update(quote.id,{syncStatus:"pending"});
  await expect(d.run(cloud)).rejects.toThrow(); expect(cloud.logs).toEqual([]);
  cloud.offline=true; await d.photos.remove(quote.id,photo.id); await expect(d.run(cloud)).rejects.toThrow();
  cloud.offline=false; await d.db.quotes.update(quote.id,{syncStatus:"synced"}); await d.run(cloud);
  expect(cloud.rows.get(photo.id)?.deleted_at).toBeTruthy(); expect(cloud.uploads).toBe(0);
});
test("B2: usunięcie podczas uploadu nie oznacza nowszej rewizji jako synced aktywnej", async () => {
  const {d,cloud,photo,quote} = await setup(); cloud.afterUpload=async () => { cloud.afterUpload=undefined; await d.photos.remove(quote.id,photo.id); };
  await d.run(cloud); expect((await d.db.quotePhotos.get(photo.id))?.blob).toBeNull(); expect(cloud.rows.get(photo.id)?.deleted_at).toBeTruthy(); expect(cloud.objects.size).toBe(0);
});
test("B2: cloud delete w trakcie downloadu nigdy nie przywraca zdjęcia", async () => {
  const ctx = await setup(); await ctx.d.run(ctx.cloud); const b = await second(ctx);
  ctx.cloud.afterDownload=async () => { ctx.cloud.afterDownload=undefined; const row=ctx.cloud.rows.get(ctx.photo.id)!; ctx.cloud.put({...row,revision:row.revision+1,deleted_at:ctx.cloud.stamp()}); };
  await b.run(ctx.cloud); expect(await b.photos.list(ctx.quote.id)).toHaveLength(0); expect(ctx.cloud.objects.size).toBe(0);
});
test("B2: te same ID i rozmiar, różne bajty: konflikt zamiast upsert", async () => {
  const {d,cloud,photo} = await setup(); cloud.loseUpload=true; await expect(d.run(cloud)).rejects.toThrow();
  const row=cloud.rows.get(photo.id)!; const bytes=new Uint8Array(await blob.arrayBuffer()); bytes[bytes.length-1]^=1;
  cloud.objects.set(row.storage_path,new Blob([bytes],{type:blob.type})); await d.run(cloud);
  expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("conflict"); expect(await sameBytes((await d.db.quotePhotos.get(photo.id))!.blob!,blob)).toBe(true);
});
test("B2: kolizja metadanych UUID blokuje również kasowanie obcego pliku", async () => {
  const {d,cloud,photo,quote} = await setup(); cloud.put({...photoToCloud(photo,workspaceId),original_file_name:"different.png",deleted_at:cloud.stamp()});
  await d.run(cloud); expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("conflict"); expect(cloud.deletes).toBe(0);
  await d.photos.remove(quote.id,photo.id); await d.run(cloud); expect(cloud.deletes).toBe(0);
});
test("B2: obcy workspace oraz obcy zakres lokalny są odrzucane", async () => {
  const {d,cloud,photo} = await setup(); const foreign="10000000-0000-4000-8000-000000000002";
  cloud.put(photoToCloud(photo,foreign)); await expect(d.run(cloud)).rejects.toThrow("innej pracowni"); expect(await d.db.photoSync.count()).toBe(0);
  await expect(new PhotoSyncEngine(new LocalPhotoSyncRepository(d.db,{...scope,workspaceId:foreign}),cloud).run()).rejects.toThrow("inną pracownią"); expect(cloud.objects.size).toBe(0);
});
for (const kind of ["mime", "size", "signature"] as const) test(`B2: download odrzuca zły ${kind}`, async () => {
  const ctx=await setup(); await ctx.d.run(ctx.cloud); const b=await second(ctx), path=ctx.cloud.rows.get(ctx.photo.id)!.storage_path;
  ctx.cloud.objects.set(path,kind==="mime" ? blob.slice(0,blob.size,"image/jpeg") : kind==="size" ? blob.slice(0,12,blob.type) : new Blob([new Uint8Array(blob.size)],{type:blob.type}));
  await expect(b.run(ctx.cloud)).rejects.toThrow(); expect(await b.db.quotePhotos.count()).toBe(0);
});
test("B2: błąd jednego pliku nie blokuje innych ani okazji synchronizacji wycen", async () => {
  const {d,cloud,photo,quote}=await setup(); cloud.put({...photoToCloud(photo,workspaceId),file_name:"collision.png"});
  const another=await d.photos.add(quote.id,{blob,fileName:"two.png",originalFileName:"two.png",width:1,height:1}); let opportunities=0;
  await d.run(cloud,undefined,async () => {opportunities++;}); expect((await d.db.quotePhotos.get(another.id))?.syncStatus).toBe("synced"); expect(opportunities).toBe(2);
});
test("B2: wylogowanie po uploadzie zachowuje pending; kolejny start rozpoznaje obiekt", async () => {
  const {d,cloud,photo}=await setup(); let active=true; cloud.afterUpload=async () => {active=false;};
  await expect(d.run(cloud,()=>{if(!active) throw new Error("logout");})).rejects.toThrow("logout");
  expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("pending"); cloud.afterUpload=undefined; await d.run(cloud); expect(cloud.uploads).toBe(1);
});
test("B2: migracja v4 → v5 zachowuje cały rekord, Blob oraz B1 journal", async () => {
  const ctx=await setup(); const options={indexedDB:new IDBFactory(),IDBKeyRange}, name=`legacy-${crypto.randomUUID()}`;
  const old=new Dexie(name,options); old.version(4).stores({quotes:"&id, createdAt, updatedAt, syncStatus, completedAt",quotePhotos:"&id, quoteId, createdAt, updatedAt, syncStatus, deletedAt",quoteSync:"&quoteId",syncSettings:"&key"});
  await old.table("quotes").add(ctx.quote); await old.table("quotePhotos").add(ctx.photo);
  await old.table("quoteSync").add({quoteId:ctx.quote.id,base:null,inFlight:null,conflict:null}); old.close();
  const current=new QuotesDatabase(name,options); databases.push(current); await current.open();
  expect(current.verno).toBe(9); expect(await current.quotePhotos.get(ctx.photo.id)).toEqual(ctx.photo); expect(await current.quotes.get(ctx.quote.id)).toEqual(ctx.quote);
  expect(await current.photoSync.count()).toBe(0); expect(await current.quoteSync.count()).toBe(1);
  expect(await sameBytes((await current.quotePhotos.get(ctx.photo.id))!.blob!,blob)).toBe(true);
});


test("B2: dwa różne zdjęcia dodane na dwóch urządzeniach zachowują oba UUID", async () => {
  const ctx=await setup(), b=await second(ctx);
  const other=await b.photos.add(ctx.quote.id,{blob,fileName:"second.png",originalFileName:"second.png",width:1,height:1});
  await ctx.d.run(ctx.cloud); await b.run(ctx.cloud); await ctx.d.run(ctx.cloud);
  expect((await ctx.d.photos.list(ctx.quote.id)).map(p=>p.id).sort()).toEqual([ctx.photo.id,other.id].sort());
  expect(ctx.cloud.rows.size).toBe(2); expect(ctx.cloud.objects.size).toBe(2);
});
test("B2: CAS wykrywa zmianę metadanych przed wysłaniem tombstone", async () => {
  const {d,cloud,photo,quote}=await setup(); await d.run(cloud); await d.photos.remove(quote.id,photo.id);
  cloud.beforeSave=async () => { cloud.beforeSave=undefined; const row=cloud.rows.get(photo.id)!; cloud.put({...row,revision:row.revision+1,file_name:"unexpected.png"}); };
  await d.run(cloud); expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("conflict"); expect(cloud.objects.size).toBe(1);
});
test("B2: przerwana migracja v5 pozostawia v4 i wszystkie Bloby", async () => {
  const ctx=await setup(), options={indexedDB:new IDBFactory(),IDBKeyRange}, name=`rollback-${crypto.randomUUID()}`;
  const old=new Dexie(name,options); old.version(4).stores({quotes:"&id",quotePhotos:"&id",quoteSync:"&quoteId",syncSettings:"&key"});
  await old.table("quotes").add(ctx.quote); await old.table("quotePhotos").add(ctx.photo); old.close();
  const broken=new QuotesDatabase(name,options); broken.version(5).upgrade(()=>{throw new Error("migration interrupted");});
  await expect(Promise.resolve(broken.open())).rejects.toThrow("migration interrupted"); broken.close();
  await old.open(); expect(old.verno).toBe(4); expect(await old.table("quotePhotos").get(ctx.photo.id)).toEqual(ctx.photo);
  expect(old.tables.map(t=>t.name)).not.toContain("photoSync"); old.close();
});


test("B2: retry samego pliku również czeka na pending rodzica", async () => {
  const {d,cloud,photo,quote}=await setup(); cloud.failUpload=true; await expect(d.run(cloud)).rejects.toThrow();
  await d.db.quotes.update(quote.id,{syncStatus:"pending"}); cloud.failUpload=false;
  await expect(d.run(cloud)).rejects.toThrow(); expect(cloud.uploads).toBe(0);
  await d.db.quotes.update(quote.id,{syncStatus:"synced"}); await d.run(cloud); expect((await d.db.quotePhotos.get(photo.id))?.syncStatus).toBe("synced");
});
