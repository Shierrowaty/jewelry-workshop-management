import { expect, test } from "@playwright/test";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { LocalQuoteRepository } from "../src/features/quotes/data/quote-repository";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { exampleCatalog } from "../src/features/quotes/catalog";
import { isHistoricalQuote } from "../src/features/quotes/historical-quote";
import { calculateKnowledge } from "../src/features/knowledge/calculations";
import { filterKnowledge, KnowledgeRepository } from "../src/features/knowledge/repository";
import { emptyKnowledgeDraft, type KnowledgeFilters } from "../src/features/knowledge/types";
import { LocalKnowledgeSync } from "../src/features/knowledge/sync/local";

let database: QuotesDatabase;
let repository: KnowledgeRepository;
test.beforeEach(() => { database = new QuotesDatabase("knowledge-tests", { indexedDB: new IDBFactory(), IDBKeyRange }); repository = new KnowledgeRepository(database); });
test.afterEach(() => database.close());
async function stoneDraft() {
  const parent = await repository.createCategory("Kamienie", null);
  const sub = await repository.createCategory("Szmaragdy", parent.id);
  return { ...emptyKnowledgeDraft("2020-02-29"), categoryId: parent.id, subcategoryId: sub.id, name: "Szmaragd", supplier: "Dostawca A", carats: "0,375", unitNetPrice: "1000,50" };
}

test("kategorie są ręczne, mają dwa poziomy i unikalne nazwy w obrębie rodzica", async () => {
  expect(await repository.list()).toEqual({ categories: [], entries: [] });
  const root = await repository.createCategory(" Kamienie ", null);
  const child = await repository.createCategory("Szmaragdy", root.id);
  await expect(repository.createCategory("kamienie", null)).rejects.toThrow("już istnieje");
  await expect(repository.createCategory("Trzeci poziom", child.id)).rejects.toThrow("bezpośrednio do działu");
  await expect(repository.createCategory(" ", null)).rejects.toThrow("Podaj nazwę");
  const other = await repository.createCategory("Wyroby", null);
  await repository.createCategory("Szmaragdy", other.id);
  expect((await repository.list()).categories).toHaveLength(4);
});

test("kamień: przeliczenie ct, grosze i VAT; sposób za sztukę ignoruje ct w cenie", async () => {
  const draft = await stoneDraft();
  expect(calculateKnowledge(draft).stone).toEqual({ net: 37519, vat: 8629, gross: 46148 });
  expect(calculateKnowledge({ ...draft, priceBasis: "piece" }).stone).toEqual({ net: 100050, vat: 23012, gross: 123062 });
  expect(calculateKnowledge({ ...draft, unitNetPrice: "0" }).stone).toEqual({ net: 0, vat: 0, gross: 0 });
  for (const patch of [{ carats: "-1" }, { unitNetPrice: "x" }, { carats: "0,0001" }, { carats: "999999999", unitNetPrice: "999999999" }]) expect(Object.keys(calculateKnowledge({ ...draft, ...patch }).errors).length).toBeGreaterThan(0);
});

test("zapis, edycja, archiwizacja i przywrócenie przetrwają ponowne otwarcie bazy", async () => {
  const draft = await stoneDraft();
  const saved = await repository.save(draft);
  database.close(); await database.open();
  expect((await repository.list()).entries).toEqual([saved]);
  const updated = await repository.save({ ...saved, notes: "Sprawdzone", unitNetPrice: "1200" }, saved);
  expect(updated).toMatchObject({ id: saved.id, createdAt: saved.createdAt, entryDate: "2020-02-29", revision: 2, notes: "Sprawdzone" });
  expect(updated.updatedAt > saved.updatedAt).toBe(true);
  await expect(repository.save(draft, saved)).rejects.toThrow("innym oknie");
  await expect(repository.remove(saved.id, saved.revision)).rejects.toThrow("innym oknie");
  await repository.setArchived(updated.id, updated.revision, true);
  const archived = (await repository.list()).entries[0]; expect(archived.archivedAt).toBeTruthy();
  await repository.setArchived(archived.id, archived.revision, false);
  const restored = (await repository.list()).entries[0]; expect(restored.archivedAt).toBeNull();
  await repository.remove(restored.id, restored.revision);
  expect((await repository.list()).entries).toEqual([]);
});

test("rekord wyrobu zachowuje ręczne ceny i nie importuje niczego z wycen", async () => {
  const quote = await new LocalQuoteRepository(database).create(createEmptyQuote("2020-01-02"), exampleCatalog);
  expect((await repository.list()).entries).toEqual([]);
  const parent = await repository.createCategory("Wyroby", null);
  const sub = await repository.createCategory("Bransoletki", parent.id);
  const draft = { ...emptyKnowledgeDraft("2020-01-03", "product"), categoryId: parent.id, subcategoryId: sub.id, name: "Bransoletka młotkowana", referenceWeight: "4,321", fineness: "585", goldColor: "Żółte", goldPricePerGram: "300", materialCost: "1300", laborPrice: "700", finishedPrice: "2500", notes: "Ręczny punkt odniesienia" };
  const saved = await repository.save(draft);
  expect(saved).toMatchObject(draft);
  await repository.setArchived(saved.id, saved.revision, true);
  expect(await database.quotes.get(quote.id)).toEqual(quote);
  expect(await database.quoteSync.count()).toBe(0);
});

test("wyszukiwanie łączy nazwę, dostawcę i uwagi z filtrami kategorii, podkategorii i archiwum", async () => {
  const draft = await stoneDraft();
  const saved = await repository.save(draft);
  await repository.save({ ...draft, name: "Szafir", supplier: "Inny", subcategoryId: "", notes: "Do oprawy" });
  await repository.setArchived(saved.id, saved.revision, true);
  const data = await repository.list();
  const filters: KnowledgeFilters = { search: "", categoryId: "", subcategoryId: "", kind: "", status: "active" };
  expect(filterKnowledge(data.entries, data.categories, filters).map(entry => entry.name)).toEqual(["Szafir"]);
  expect(filterKnowledge(data.entries, data.categories, { ...filters, search: "  DOSTAWCA A ", status: "archived", categoryId: draft.categoryId, subcategoryId: draft.subcategoryId, kind: "stone" })).toHaveLength(1);
  expect(filterKnowledge(data.entries, data.categories, { ...filters, search: "do oprawy" })).toHaveLength(1);
  expect(filterKnowledge(data.entries, data.categories, { ...filters, kind: "product", status: "all" })).toEqual([]);
});

test("walidacja blokuje niepoprawne daty, ceny i obce podkategorie bez częściowego zapisu", async () => {
  const draft = await stoneDraft();
  for (const patch of [{ name: " " }, { entryDate: "2025-02-29" }, { entryDate: "" }, { unitNetPrice: "-1" }]) await expect(repository.save({ ...draft, ...patch })).rejects.toThrow("Popraw");
  const other = await repository.createCategory("Inne", null);
  await expect(repository.save({ ...draft, categoryId: other.id })).rejects.toThrow("nie należy");
  await expect(repository.save({ ...draft, categoryId: draft.subcategoryId, subcategoryId: "" })).rejects.toThrow("istniejący dział lub grupę");
  expect((await repository.list()).entries).toEqual([]);
});

const legacyStores = { quotes: "&id, createdAt, updatedAt, syncStatus, completedAt", quotePhotos: "&id, quoteId, createdAt, updatedAt, syncStatus, deletedAt", quoteSync: "&quoteId", syncSettings: "&key", photoSync: "&photoId, quoteId, phase", appLogs: "&id, createdAt, level, category" };
test("migracja v6 → v7 dodaje puste tabele wiedzy i zachowuje wyceny, zdjęcia, logi i synchronizację", async () => {
  const factory = new IDBFactory();
  const old = new Dexie("migration-knowledge", { indexedDB: factory, IDBKeyRange }); old.version(6).stores(legacyStores);
  const quote = await new LocalQuoteRepository(database).create(createEmptyQuote("2019-11-20"), exampleCatalog);
  const fixtures = { quotes: quote, quotePhotos: { id: "photo", quoteId: quote.id, blob: new Blob(["photo bytes"]) }, quoteSync: { quoteId: quote.id, base: null }, syncSettings: { key: "workspace", workspaceId: "unchanged" }, photoSync: { photoId: "photo", quoteId: quote.id, phase: "upload" }, appLogs: { id: "log", category: "database", createdAt: quote.createdAt } };
  for (const [table, row] of Object.entries(fixtures)) await old.table(table).put(row);
  old.close();
  const current = new QuotesDatabase("migration-knowledge", { indexedDB: factory, IDBKeyRange });
  try {
    await current.open(); expect(current.verno).toBe(9);
    for (const [table, row] of Object.entries(fixtures)) expect(await current.table(table).toArray()).toEqual([row]);
    expect(await current.knowledgeCategories.count()).toBe(0); expect(await current.knowledgeEntries.count()).toBe(0);
  } finally { current.close(); }
});

test("przerwana migracja Bazy wiedzy zostawia działającą bazę v6", async () => {
  const factory = new IDBFactory();
  const old = new Dexie("migration-abort", { indexedDB: factory, IDBKeyRange }); old.version(6).stores(legacyStores);
  await old.table("quotes").put({ id: "preserved", snapshot: { price: 12345 } }); old.close();
  const broken = new QuotesDatabase("migration-abort", { indexedDB: factory, IDBKeyRange }); broken.version(7).upgrade(() => { throw new Error("abort test"); });
  await expect(Promise.resolve(broken.open())).rejects.toThrow("abort test"); broken.close();
  try { await old.open(); expect(old.verno).toBe(6); expect(await old.table("quotes").get("preserved")).toEqual({ id: "preserved", snapshot: { price: 12345 } }); }
  finally { old.close(); }
});

test("ręcznie dodana wycena z przeszłości zachowuje wskazaną datę i niezależną datę utworzenia", async () => {
  const quotes = new LocalQuoteRepository(database);
  const draft = createEmptyQuote("2018-03-14"); draft.customer.name = "Wpis historyczny";
  const quote = await quotes.create(draft, exampleCatalog);
  database.close(); await database.open();
  expect((await quotes.get(quote.id))?.snapshot.customer.quoteDate).toBe("2018-03-14");
  const updated = await quotes.updateMetadata(quote.id, quote.revision, { status: "Gotowe", dueDate: "", notes: "Uzupełnienie" });
  expect(updated.snapshot.customer.quoteDate).toBe("2018-03-14"); expect(updated.createdAt).toBe(quote.createdAt);
  expect(isHistoricalQuote("2018-03-14", "2026-09-07")).toBe(true);
  expect(isHistoricalQuote("2018-03-14", "2018-03-14")).toBe(false);
  expect(isHistoricalQuote("2027-01-01", "2026-09-07")).toBe(false);
});

test("katalog: zapis bez grupy tworzy dział atomowo, bez wstępnej konfiguracji", async () => {
  await expect(repository.saveCatalogEntry(emptyKnowledgeDraft("2026-09-12"))).rejects.toThrow();
  expect(await repository.list()).toEqual({ categories: [], entries: [] });
  await expect(repository.createGroup(" ", "product")).rejects.toThrow();
  expect(await repository.list()).toEqual({ categories: [], entries: [] });
  const draft = { ...emptyKnowledgeDraft("2026-09-12"), name: "Bez przypisania" };
  const [a, b] = await Promise.all([repository.saveCatalogEntry(draft), repository.saveCatalogEntry({ ...draft, name: "Drugi" })]);
  expect(a.categoryId).toBe(b.categoryId);
  expect(a.subcategoryId).toBe("");
  expect((await repository.list()).categories).toHaveLength(1);
  const group = await repository.createGroup("Szmaragdy", "stone");
  const assigned = await repository.saveCatalogEntry({ ...a, subcategoryId: group.id }, a);
  const ungrouped = await repository.saveCatalogEntry({ ...assigned, categoryId: "", subcategoryId: "" }, assigned);
  expect(ungrouped).toMatchObject({ id: a.id, createdAt: a.createdAt, categoryId: a.categoryId, subcategoryId: "", revision: 3 });
});

test("katalog: starsze przypisania pozostają niezmienione, grupy są płaskie i rozróżniają duplikaty", async () => {
  const { catalogGroups, entryGroupId, groupAssignment } = await import("../src/features/knowledge/catalog");
  const root = await repository.createCategory("Materiały specjalne", null);
  const child = await repository.createCategory("Zielone", root.id);
  const entry = await repository.save({ ...emptyKnowledgeDraft("2026-09-12"), name: "Starszy rekord", categoryId: root.id, subcategoryId: child.id });
  const before = await repository.list();
  expect(entryGroupId(entry, before.categories)).toBe(child.id);
  expect(entryGroupId({ ...entry, subcategoryId: "" }, before.categories)).toBe(root.id);
  expect(catalogGroups(before.categories, "stone", before.entries).map(group => group.label)).toEqual(["Materiały specjalne", "Materiały specjalne · Zielone"]);
  expect(groupAssignment(child.id, before.categories)).toEqual({ categoryId: root.id, subcategoryId: child.id });
  expect(await repository.list()).toEqual(before);
  const duplicate = { ...child, id: crypto.randomUUID() };
  const labels = catalogGroups([...before.categories, duplicate], "stone").map(group => group.label);
  expect(new Set(labels).size).toBe(3);
});

test("zmiana nazwy grupy zachowuje przypisania, kolejkę synchronizacji i blokuje nieaktualną edycję", async () => {
  const draft = await stoneDraft();
  const saved = await repository.save(draft);
  const group = (await repository.list()).categories.find(item => item.id === draft.subcategoryId)!;
  const renamed = await repository.renameGroup(group, "Szmaragdy naturalne");
  expect(renamed.id).toBe(group.id);
  expect(renamed.createdAt).toBe(group.createdAt);
  expect((await repository.list()).entries).toEqual([saved]);
  expect((await new LocalKnowledgeSync(database).summary()).pending.some(state => state.id === group.id)).toBe(true);
  await expect(repository.renameGroup(group, "Nieaktualna nazwa")).rejects.toThrow("innym oknie");
  await repository.createGroup("Szafiry", "stone");
  await expect(repository.renameGroup(renamed, "Szafiry")).rejects.toThrow("już istnieje");
  const root = (await repository.list()).categories.find(item => item.id === draft.categoryId)!;
  await expect(repository.renameGroup(root, "Nowy dział")).rejects.toThrow("stałe");
});
