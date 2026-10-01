import { expect, test } from "@playwright/test";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { LocalQuoteRepository, QuoteNotFoundError } from "../src/features/quotes/data/quote-repository";
import { draftFromQuote } from "../src/features/quotes/data/snapshot";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { exampleCatalog } from "../src/features/quotes/catalog";
import { LocalQuotePhotoRepository } from "../src/features/quotes/photos/photo-repository";
import { PHOTO_MAX_BYTES, PhotoError, type PreparedPhoto } from "../src/features/quotes/photos/types";

// Repository tests exercise opaque binary persistence; real decoding/compression is tested in Edge.
const prepared = (): PreparedPhoto => ({ fileName: "detal.webp", originalFileName: "detal.jpg", width: 1920, height: 1280, blob: new Blob([new Uint8Array([17, 42, 255, 0])], { type: "image/webp" }) });
let database: QuotesDatabase;
let quotes: LocalQuoteRepository;
let photos: LocalQuotePhotoRepository;
test.beforeEach(() => {
  database = new QuotesDatabase("photo-unit-tests", { indexedDB: new IDBFactory(), IDBKeyRange });
  quotes = new LocalQuoteRepository(database);
  photos = new LocalQuotePhotoRepository(database);
});
test.afterEach(() => database.close());
const createQuote = () => quotes.create(createEmptyQuote("2026-09-04"), exampleCatalog);

test("zapisuje Blob i metadane osobno, bez zmiany wyceny i jej rewizji", async () => {
  const quote = await createQuote();
  const input = prepared();
  const saving = photos.add(quote.id, input);
  input.fileName = "zmieniona.webp";
  const photo = await saving;
  expect(photo.id).toMatch(/^[\da-f-]{36}$/);
  expect(photo).toMatchObject({ quoteId: quote.id, fileName: "detal.webp", originalFileName: "detal.jpg", mimeType: "image/webp", size: 4, width: 1920, height: 1280, syncStatus: "pending", revision: 1, schemaVersion: 1, deletedAt: null });
  expect(photo.createdAt).toBe(photo.updatedAt);
  const [saved] = await photos.list(quote.id);
  expect(saved.blob).toBeInstanceOf(Blob);
  expect(new Uint8Array(await saved.blob.arrayBuffer())).toEqual(new Uint8Array([17, 42, 255, 0]));
  expect(await quotes.get(quote.id)).toEqual(quote);
});

test("wiele zdjęć jest związanych wyłącznie ze swoją realizacją", async () => {
  const first = await createQuote();
  const second = await createQuote();
  const a = await photos.add(first.id, prepared());
  const b = await photos.add(first.id, prepared());
  const c = await photos.add(second.id, prepared());
  expect((await photos.list(first.id)).map((photo) => photo.id).sort()).toEqual([a.id, b.id].sort());
  expect((await photos.list(second.id)).map((photo) => photo.id)).toEqual([c.id]);
  await expect(photos.remove(second.id, a.id)).rejects.toBeInstanceOf(PhotoError);
  expect(await photos.list(first.id)).toHaveLength(2);
});

test("ponowne otwarcie bazy zachowuje dokładne bajty zdjęcia", async () => {
  const options = { indexedDB: new IDBFactory(), IDBKeyRange };
  const db = new QuotesDatabase("photo-reopen", options);
  try {
    const quote = await new LocalQuoteRepository(db).create(createEmptyQuote("2026-09-04"), exampleCatalog);
    const original = await new LocalQuotePhotoRepository(db).add(quote.id, prepared());
    db.close();
    await db.open();
    const [photo] = await new LocalQuotePhotoRepository(db).list(quote.id);
    expect(photo).toEqual(original);
    expect(await photo.blob.arrayBuffer()).toEqual(await original.blob.arrayBuffer());
  } finally { db.close(); }
});

test("edycja, zakończenie i przywrócenie nie zmieniają zdjęć", async () => {
  let quote = await createQuote();
  const photo = await photos.add(quote.id, prepared());
  const draft = draftFromQuote(quote);
  draft.gold.mass = "6";
  draft.gold.purchasePerGram = "350";
  quote = await quotes.updateQuote(quote.id, quote.revision, draft, exampleCatalog);
  expect(await photos.list(quote.id)).toEqual([photo]);
  quote = await quotes.setCompleted(quote.id, quote.revision, true);
  expect(await photos.list(quote.id)).toEqual([photo]);
  await quotes.setCompleted(quote.id, quote.revision, false);
  expect(await photos.list(quote.id)).toEqual([photo]);
});

test("usunięcie zwalnia Blob jednego zdjęcia i zachowuje znacznik przyszłej synchronizacji", async () => {
  const quote = await createQuote();
  const removed = await photos.add(quote.id, prepared());
  const kept = await photos.add(quote.id, prepared());
  await photos.remove(quote.id, removed.id);
  expect(await photos.list(quote.id)).toEqual([kept]);
  const marker = await database.quotePhotos.get(removed.id);
  expect(marker).toMatchObject({ blob: null, revision: 2, syncStatus: "pending", createdAt: removed.createdAt, quoteId: quote.id });
  expect(marker?.deletedAt).toBe(marker?.updatedAt);
  expect(marker!.updatedAt > removed.updatedAt).toBe(true);
  await photos.remove(quote.id, removed.id);
  expect(await database.quotePhotos.get(removed.id)).toEqual(marker);
  expect(await quotes.get(quote.id)).toEqual(quote);
});

test("odrzuca zdjęcia bez realizacji i nieprzygotowane pliki bez częściowego zapisu", async () => {
  await expect(photos.add("missing", prepared())).rejects.toBeInstanceOf(QuoteNotFoundError);
  const quote = await createQuote();
  for (const invalid of [
    { ...prepared(), blob: new Blob([]) },
    { ...prepared(), blob: new Blob(["svg"], { type: "image/svg+xml" }) },
    { ...prepared(), blob: new Blob([new Uint8Array(PHOTO_MAX_BYTES + 1)], { type: "image/jpeg" }) },
    { ...prepared(), width: 8000 }, { ...prepared(), height: NaN },
  ]) await expect(photos.add(quote.id, invalid)).rejects.toBeInstanceOf(PhotoError);
  expect(await database.quotePhotos.count()).toBe(0);
});

test("brak miejsca lub błąd usunięcia nie narusza istniejących zdjęć", async () => {
  const quote = await createQuote();
  const photo = await photos.add(quote.id, prepared());
  database.quotePhotos.hook("creating", () => { throw new DOMException("Full", "QuotaExceededError"); });
  await expect(photos.add(quote.id, prepared())).rejects.toThrow();
  database.quotePhotos.hook("updating", () => { throw new Error("Failed write"); });
  await expect(photos.remove(quote.id, photo.id)).rejects.toThrow();
  expect(await photos.list(quote.id)).toEqual([photo]);
  expect(await quotes.get(quote.id)).toEqual(quote);
});

test("migracja v2 → v4 dodaje puste tabele, zachowując aktywne i zakończone rekordy", async () => {
  const active = await createQuote();
  const sample = await createQuote();
  const completed = await quotes.setCompleted(sample.id, 1, true);
  const options = { indexedDB: new IDBFactory(), IDBKeyRange };
  const old = new Dexie("photo-migration", options);
  old.version(2).stores({ quotes: "&id, createdAt, updatedAt, syncStatus, completedAt" });
  await old.table("quotes").bulkAdd([active, completed]);
  old.close();
  const current = new QuotesDatabase("photo-migration", options);
  try {
    await current.open();
    expect(current.verno).toBe(9);
    expect(await current.quotePhotos.count()).toBe(0);
    expect(await current.quotes.get(active.id)).toEqual(active);
    expect(await current.quotes.get(completed.id)).toEqual(completed);
    const photo = await new LocalQuotePhotoRepository(current).add(completed.id, prepared());
    current.close();
    await current.open();
    expect(await new LocalQuotePhotoRepository(current).list(completed.id)).toEqual([photo]);
  } finally { current.close(); }
});

test("przerwana migracja v3 pozostawia działającą bazę v2 i wszystkie jej dane", async () => {
  const quote = await createQuote();
  const options = { indexedDB: new IDBFactory(), IDBKeyRange };
  const old = new Dexie("photo-failed-migration", options);
  old.version(2).stores({ quotes: "&id, createdAt, updatedAt, syncStatus, completedAt" });
  await old.table("quotes").add(quote);
  old.close();
  const failing = new QuotesDatabase("photo-failed-migration", options);
  failing.version(3).upgrade(() => { throw new Error("Przerwano dodawanie galerii"); });
  await expect(Promise.resolve(failing.open())).rejects.toThrow("Przerwano dodawanie galerii");
  failing.close();
  try {
    await old.open();
    expect(old.verno).toBe(2);
    expect(await old.table("quotes").get(quote.id)).toEqual(quote);
    expect(old.tables.map((table) => table.name)).toEqual(["quotes"]);
  } finally { old.close(); }
});
