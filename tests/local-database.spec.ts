import { expect, test } from "@playwright/test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import Dexie from "dexie";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { LocalQuoteRepository, InvalidQuoteError, QuoteConflictError, QuoteNotFoundError } from "../src/features/quotes/data/quote-repository";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { exampleCatalog } from "../src/features/quotes/catalog";
import { localDataError } from "../src/features/quotes/data/storage";
import { catalogForQuote, draftFromQuote } from "../src/features/quotes/data/snapshot";

function example() {
  const draft = createEmptyQuote("2026-09-03");
  delete draft.pricing; // Historical calculator fixture; current pricing is tested separately.
  draft.customer = { ...draft.customer, name: "Klient testowy", channel: "SMS", contact: "kontakt testowy", notes: "Pierwsze ustalenia" };
  draft.product = { categoryId: "rings", modelId: "ring-classic", customDesign: false, customName: "", variant: "Rozmiar 14" };
  draft.gold = { ...draft.gold, mass: "5,5", purchasePerGram: "350", markupPerGram: "350" };
  draft.stones = [{ id: "stone-test", name: "Kamień testowy", quantity: "1", purchasePrice: "200", plannedProfit: "800", customerOwned: false }];
  draft.labor = [{ id: "labor-test", name: "Wykonanie", amount: "2000" }];
  draft.otherCosts = [{ id: "shipping-test", name: "Wysyłka", amount: "25" }, { id: "box-test", name: "Pudełko", amount: "10" }];
  return draft;
}

let database: QuotesDatabase;
let repository: LocalQuoteRepository;

test.beforeEach(() => {
  // A fresh, memory-only IndexedDB implementation: never the user's browser database.
  database = new QuotesDatabase("quotes-unit-tests", { indexedDB: new IDBFactory(), IDBKeyRange });
  repository = new LocalQuoteRepository(database);
});

test.afterEach(() => database.close());

test("nowa baza nie zawiera automatycznie dodanych rekordów", async () => {
  expect(await repository.list()).toEqual([]);
  expect(database.verno).toBe(9);
  expect(database.tables.map((table) => table.name).sort()).toEqual(["appLogs", "calculationTransfers", "calculations", "knowledgeCategories", "knowledgeEntries", "knowledgeSync", "photoSync", "quotePhotos", "quoteSync", "quotes", "syncSettings"]);
});

test("zapisuje pełny snapshot, UUID, czas i dokładne wyniki istniejącego kalkulatora", async () => {
  const draft = example();
  const catalog = structuredClone(exampleCatalog);
  const saving = repository.create(draft, catalog);
  draft.gold.purchasePerGram = "999";
  draft.stones[0].purchasePrice = "999";
  catalog.models[0].name = "Nowa nazwa";
  const quote = await saving;
  expect(quote.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  expect(quote.createdAt).toBe(quote.updatedAt);
  expect(Number.isNaN(Date.parse(quote.createdAt))).toBe(false);
  expect(quote).toMatchObject({ syncStatus: "pending", revision: 1, schemaVersion: 2, calculationVersion: 1, completedAt: null, status: "Wycena", dueDate: "", notes: "Pierwsze ustalenia" });
  expect(quote.snapshot).toMatchObject({
    customer: { name: "Klient testowy", channel: "SMS", contact: "kontakt testowy", quoteDate: "2026-09-03" },
    categoryName: "Pierścionki", modelName: "Klasyczny z jednym kamieniem",
    gold: { mass: "5,5", purchasePerGram: "350", markupPerGram: "350" },
    stones: [{ purchasePrice: "200", plannedProfit: "800" }],
    vatRate: "23", agreedGross: "",
    totals: { gold: { purchaseCost: 192500, profit: 192500 }, stoneCost: 20000, stoneProfit: 80000, externalCost: 3500, totalCost: 216000, plannedProfit: 472500, net: 688500, vat: 158355, gross: 846855 },
  });
  expect(await repository.get(quote.id)).toEqual(quote);
  expect(quote.snapshot.labor).toEqual(example().labor);
  expect(quote.snapshot.otherCosts).toEqual(example().otherCosts);
});

test("zamknięcie połączenia i nowy cennik nie zmieniają historycznej wyceny", async () => {
  const indexedDB = new IDBFactory();
  database.close();
  database = new QuotesDatabase("reopen-test", { indexedDB, IDBKeyRange });
  repository = new LocalQuoteRepository(database);
  const original = await repository.create(example(), exampleCatalog);
  database.close();
  database = new QuotesDatabase("reopen-test", { indexedDB, IDBKeyRange });
  repository = new LocalQuoteRepository(database);
  const newer = example();
  newer.gold.purchasePerGram = "900";
  newer.stones[0].purchasePrice = "400";
  newer.labor[0].amount = "7000";
  newer.vatRate = "8";
  const catalog = structuredClone(exampleCatalog);
  catalog.categories[0].name = "Zmieniona kategoria";
  catalog.models[0].name = "Zmieniony model";
  await repository.create(newer, catalog);
  expect(await repository.get(original.id)).toEqual(original);
});

test("aktualizuje tylko status, termin, uwagi i metadane zapisu", async () => {
  const original = await repository.create(example(), exampleCatalog);
  const updated = await repository.updateMetadata(original.id, 1, { status: "W produkcji", dueDate: "2026-10-15", notes: "Nowe ustalenia" });
  expect(updated.snapshot).toEqual(original.snapshot);
  expect(updated.id).toBe(original.id);
  expect(updated.createdAt).toBe(original.createdAt);
  expect(updated.updatedAt > original.updatedAt).toBe(true);
  expect(updated.revision).toBe(2);
  expect(await repository.get(original.id)).toEqual(updated);
  const cleared = await repository.updateMetadata(original.id, 2, { status: "Gotowe", dueDate: "", notes: "" });
  expect(cleared).toMatchObject({ dueDate: "", notes: "", revision: 3, syncStatus: "pending", completedAt: null });
  expect(cleared.snapshot).toEqual(original.snapshot);
});

test("równoczesne zmiany z dwóch kart nie nadpisują nowszego rekordu", async () => {
  const original = await repository.create(example(), exampleCatalog);
  const updates = await Promise.allSettled([
    repository.updateMetadata(original.id, 1, { status: "Gotowe", dueDate: "", notes: "Karta A" }),
    repository.updateMetadata(original.id, 1, { status: "Anulowane", dueDate: "", notes: "Karta B" }),
  ]);
  expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = updates.find((result) => result.status === "rejected");
  expect(rejected?.reason).toBeInstanceOf(QuoteConflictError);
  const saved = await repository.get(original.id);
  expect(saved?.revision).toBe(2);
  expect(saved?.snapshot).toEqual(original.snapshot);
});

test("błędna wycena i nieistniejący rekord nie powodują zapisu", async () => {
  const draft = example();
  draft.gold.mass = "błędna masa";
  await expect(repository.create(draft, exampleCatalog)).rejects.toBeInstanceOf(InvalidQuoteError);
  await expect(repository.updateMetadata("missing", 1, { status: "Wycena", dueDate: "", notes: "" })).rejects.toBeInstanceOf(QuoteNotFoundError);
  expect(await repository.list()).toEqual([]);
});

test("błąd transakcji nie pozostawia częściowego zapisu ani zmian", async () => {
  const original = await repository.create(example(), exampleCatalog);
  database.quotes.hook("creating", () => { throw new DOMException("Full", "QuotaExceededError"); });
  await expect(repository.create(example(), exampleCatalog)).rejects.toThrow();
  database.quotes.hook("updating", () => { throw new DOMException("Full", "QuotaExceededError"); });
  await expect(repository.updateMetadata(original.id, 1, { status: "Gotowe", dueDate: "", notes: "Nie zapisze się" })).rejects.toThrow();
  await expect(repository.updateQuote(original.id, 1, example(), exampleCatalog)).rejects.toThrow();
  await expect(repository.setCompleted(original.id, 1, true)).rejects.toThrow();
  expect(await repository.list()).toEqual([original]);
  expect(localDataError(new DOMException("Full", "QuotaExceededError"))).toContain("Brak miejsca");
});

test("zachowuje uzgodnioną cenę i pomijane kwoty kamienia klienta", async () => {
  const draft = example();
  draft.agreedGross = "8000,00";
  draft.stones[0].customerOwned = true;
  draft.gold.markupPerGram = "";
  draft.product.customDesign = true;
  draft.product.customName = "Własny projekt";
  const original = await repository.create(draft, exampleCatalog);
  const quote = await repository.get(original.id);
  expect(quote?.snapshot).toMatchObject({ agreedGross: "8000,00", product: { customName: "Własny projekt", customDesign: true }, gold: { markupPerGram: "" }, stones: [{ customerOwned: true, purchasePrice: "200", plannedProfit: "800" }], totals: { manualPrice: true, gross: 800000, stoneCost: 0, stoneProfit: 0 } });
});

test("sortuje od najnowszego utworzenia, a edycja nie zmienia kolejności", async () => {
  const older = await repository.create(example(), exampleCatalog);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newer = await repository.create(example(), exampleCatalog);
  await repository.updateMetadata(older.id, 1, { status: "Gotowe", dueDate: "", notes: "" });
  expect((await repository.list()).map((quote) => quote.id)).toEqual([newer.id, older.id]);
});

test("pełna edycja aktualizuje ten sam rekord i przelicza nowe wartości", async () => {
  const original = await repository.create(example(), exampleCatalog);
  const draft = draftFromQuote(original);
  expect(draft).toEqual(example());
  draft.customer = { name: "Zmieniony klient", channel: "WhatsApp", contact: "Nowy kontakt", quoteDate: "2026-08-10", dueDate: "2026-11-01", status: "Gotowe", notes: "Zmiana zamówienia" };
  draft.product = { categoryId: "other", modelId: "other-product", customDesign: true, customName: "Nowy projekt", variant: "Nowy wariant" };
  draft.gold.mass = "6";
  draft.gold.fineness = "750";
  draft.gold.color = "Różowe";
  draft.stones[0].purchasePrice = "250";
  draft.labor.push({ id: "engraving", name: "Grawer", amount: "100" });
  const expected = structuredClone(draft);
  const saving = repository.updateQuote(original.id, 1, draft, exampleCatalog);
  draft.gold.mass = "999";
  const updated = await saving;
  expect(draftFromQuote(updated)).toEqual(expected);
  expect(updated).toMatchObject({ id: original.id, createdAt: original.createdAt, revision: 2, syncStatus: "pending", completedAt: null });
  expect(updated.updatedAt > original.updatedAt).toBe(true);
  expect(updated.snapshot).toMatchObject({ categoryName: "Inne", modelName: "Inny produkt", totals: { totalCost: 238500, plannedProfit: 500000, net: 738500, vat: 169855, gross: 908355 } });
  expect(await repository.list()).toEqual([updated]);
  expect(original.snapshot.gold.mass).toBe("5,5");
});

test("edycja zachowuje stare nazwy i ceny mimo zmiany lub usunięcia katalogu", async () => {
  const original = await repository.create(example(), exampleCatalog);
  const changedCatalog = structuredClone(exampleCatalog);
  changedCatalog.categories[0].name = "Nowa nazwa kategorii";
  changedCatalog.models[0].name = "Nowa nazwa modelu";
  for (const catalog of [changedCatalog, { categories: [], models: [] }]) {
    const editCatalog = catalogForQuote(catalog, original.snapshot);
    expect(editCatalog.categories.find((item) => item.id === "rings")?.name).toBe("Pierścionki");
    expect(editCatalog.models.find((item) => item.id === "ring-classic")?.name).toBe("Klasyczny z jednym kamieniem");
  }
  const draft = draftFromQuote(original);
  draft.customer.notes = "Zmiana wyłącznie uwag";
  const updated = await repository.updateQuote(original.id, 1, draft, changedCatalog);
  expect(updated.snapshot).toEqual(original.snapshot);
  expect(updated.snapshot.gold.purchasePerGram).toBe("350");
});

test("pełna edycja obsługuje złoto klienta, kamienie, inne koszty, VAT i cenę uzgodnioną", async () => {
  const original = await repository.create(example(), exampleCatalog);
  const draft = draftFromQuote(original);
  draft.gold = { source: "mixed", fineness: "333", color: "Białe", mass: "6", customerMass: "1", purchasePerGram: "400,25", markupPerGram: "" };
  draft.stones = [{ id: "customer-stone", name: "Własny kamień", quantity: "2", purchasePrice: "300", plannedProfit: "", customerOwned: true }];
  draft.labor = [{ id: "setting", name: "Oprawa", amount: "150,50" }];
  draft.otherCosts = [{ id: "contractor", name: "Podwykonawca", amount: "120,25" }];
  draft.vatRate = "8";
  draft.agreedGross = "3000,00";
  const updated = await repository.updateQuote(original.id, 1, draft, exampleCatalog);
  expect(draftFromQuote(updated)).toEqual(draft);
  expect(updated.snapshot.totals).toMatchObject({ gold: { ourMassMilligrams: 5000, purchaseCost: 200125, profit: 0 }, stoneCost: 0, stoneProfit: 0, externalCost: 12025, labor: 15050, gross: 300000, net: 277778, vat: 22222, manualPrice: true });
});

test("błędna pełna edycja nie zmienia zapisanego rekordu", async () => {
  const original = await repository.create(example(), exampleCatalog);
  const draft = draftFromQuote(original);
  draft.gold.mass = "błąd";
  await expect(repository.updateQuote(original.id, 1, draft, exampleCatalog)).rejects.toBeInstanceOf(InvalidQuoteError);
  expect(await repository.get(original.id)).toEqual(original);
  await expect(repository.updateQuote("missing", 1, example(), exampleCatalog)).rejects.toBeInstanceOf(QuoteNotFoundError);
  await expect(repository.setCompleted("missing", 1, true)).rejects.toBeInstanceOf(QuoteNotFoundError);
});

test("zakończenie i przywrócenie zachowują dane oraz są niezależne od statusu", async () => {
  let current = await repository.create(example(), exampleCatalog);
  const original = structuredClone(current);
  for (const status of ["Gotowe", "Odebrane", "Anulowane"]) {
    current = await repository.updateMetadata(current.id, current.revision, { status, dueDate: "", notes: current.notes });
    expect(current.completedAt).toBeNull();
  }
  const completed = await repository.setCompleted(current.id, current.revision, true);
  expect(completed.completedAt).toBe(completed.updatedAt);
  expect(completed.revision).toBe(current.revision + 1);
  expect(completed.snapshot).toEqual(original.snapshot);
  expect(completed.status).toBe("Anulowane");
  const draft = draftFromQuote(completed);
  draft.customer.status = "W produkcji";
  draft.customer.notes = "Edycja zakończonej realizacji";
  const edited = await repository.updateQuote(completed.id, completed.revision, draft, exampleCatalog);
  expect(edited.completedAt).toBe(completed.completedAt);
  const restored = await repository.setCompleted(edited.id, edited.revision, false);
  expect(restored.completedAt).toBeNull();
  expect(restored.snapshot).toEqual(edited.snapshot);
  expect(restored.status).toBe("W produkcji");
  expect(restored.createdAt).toBe(original.createdAt);
  expect(restored.updatedAt > edited.updatedAt).toBe(true);
  expect(restored.revision).toBe(edited.revision + 1);
  expect(restored.syncStatus).toBe("pending");
  expect(await repository.list()).toEqual([restored]);
});

test("konflikt chroni pełną edycję, zakończenie i przywrócenie", async () => {
  const original = await repository.create(example(), exampleCatalog);
  const changed = draftFromQuote(original);
  changed.gold.mass = "6";
  const updates = await Promise.allSettled([
    repository.updateQuote(original.id, 1, changed, exampleCatalog),
    repository.setCompleted(original.id, 1, true),
  ]);
  expect(updates.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  expect(updates.find((value) => value.status === "rejected")?.reason).toBeInstanceOf(QuoteConflictError);
  const winner = await repository.get(original.id);
  await expect(repository.updateQuote(original.id, 1, changed, exampleCatalog)).rejects.toBeInstanceOf(QuoteConflictError);
  await expect(repository.setCompleted(original.id, 1, false)).rejects.toBeInstanceOf(QuoteConflictError);
  expect(await repository.get(original.id)).toEqual(winner);
});

test("migracja v1 → v4 zachowuje wszystkie rekordy, snapshoty, daty i rewizje", async () => {
  const sample = await repository.create(example(), exampleCatalog);
  const { completedAt: ignored, ...withoutCompletion } = sample;
  expect(ignored).toBeNull();
  const legacy = ["Wycena", "Odebrane", "Anulowane"].map((status, index) => ({
    ...structuredClone(withoutCompletion), id: `legacy-${index}`, schemaVersion: 1,
    syncStatus: "local", status, createdAt: "2025-01-01T10:00:00.000Z", updatedAt: "2025-02-02T12:00:00.000Z", revision: 7 + index,
  }));
  const options = { indexedDB: new IDBFactory(), IDBKeyRange };
  const v1 = new Dexie("migration-test", options);
  v1.version(1).stores({ quotes: "&id, createdAt, updatedAt, syncStatus" });
  await v1.table("quotes").bulkAdd(legacy);
  v1.close();
  const v2 = new QuotesDatabase("migration-test", options);
  try {
    const migrated = new LocalQuoteRepository(v2);
    for (const old of legacy) expect(await migrated.get(old.id)).toEqual({ ...old, schemaVersion: 2, completedAt: null });
    expect(await migrated.list()).toHaveLength(3);
    expect(v2.verno).toBe(9);
    expect(await v2.quotePhotos.count()).toBe(0);
    v2.close();
    await v2.open();
    expect(await migrated.get(legacy[0].id)).toEqual({ ...legacy[0], schemaVersion: 2, completedAt: null });
    const edited = await migrated.updateQuote(legacy[0].id, 7, draftFromQuote((await migrated.get(legacy[0].id))!), exampleCatalog);
    expect(edited).toMatchObject({ revision: 8, syncStatus: "pending", createdAt: legacy[0].createdAt });
  } finally {
    v2.close();
  }
});

test("przerwana migracja wycofuje całą zmianę zamiast kasować bazę v1", async () => {
  const sample = await repository.create(example(), exampleCatalog);
  const { completedAt: ignored, ...withoutCompletion } = sample;
  expect(ignored).toBeNull();
  const legacy = { ...withoutCompletion, schemaVersion: 1, syncStatus: "local" };
  const options = { indexedDB: new IDBFactory(), IDBKeyRange };
  const v1 = new Dexie("failed-migration", options);
  v1.version(1).stores({ quotes: "&id, createdAt, updatedAt, syncStatus" });
  await v1.table("quotes").add(legacy);
  v1.close();
  const failing = new QuotesDatabase("failed-migration", options);
  failing.version(2).upgrade(() => { throw new Error("Przerwana migracja testowa"); });
  await expect(Promise.resolve(failing.open())).rejects.toThrow("Przerwana migracja testowa");
  failing.close();
  try {
    await v1.open();
    expect(await v1.table("quotes").get(legacy.id)).toEqual(legacy);
    expect(v1.verno).toBe(1);
  } finally {
    v1.close();
  }
});


test("nowa wycena zachowuje pseudonim, produkt, próby, kamienie i kierunek ceny po ponownym otwarciu", async () => {
  const draft = createEmptyQuote("2026-09-06");
  draft.customer.nickname = "Próba lokalna";
  Object.assign(draft.product, { weight: "6", size: "14", goldColor: "Białe", twoColors: true, colorOne: "Żółta szyna", colorTwo: "Biała oprawka" });
  Object.assign(draft.gold, { source: "mixed", ourMass: "1,5", purchasePerGram: "350", estimatedMass: "6,5", customerLots: [{ id: "a", fineness: "585", mass: "2" }, { id: "b", fineness: "750", mass: "1" }] });
  draft.stones = [{ id: "stone", catalogId: "diamond", name: "Historyczny diament", quantity: "3", carats: "0,5", shape: "Owal", dimensions: "5 × 4 mm", priceBasis: "carat", purchasePrice: "1000", plannedProfit: "", customerOwned: false }];
  draft.pricing!.desiredCleanProfit = "880";
  const saved = await repository.create(draft, exampleCatalog);
  expect(saved.snapshot.totals).toMatchObject({ totalCost: 185378, gross: 351015, net: 285378, profit: 100000, cleanProfit: 88000, estimatedTax: 12000 });
  database.close();
  await database.open();
  const restored = await repository.get(saved.id);
  expect(restored).toEqual(saved);
  const edit = draftFromQuote(restored!);
  expect(edit.customer).toMatchObject({ name: "", nickname: "Próba lokalna" });
  expect(edit.product).toEqual(draft.product);
  expect(edit.stones).toEqual(draft.stones);
  expect(edit.gold.customerLots).toEqual(draft.gold.customerLots);
  expect(edit.pricing).toEqual(draft.pricing);
  edit.pricing = { ...edit.pricing!, basis: "gross" };
  edit.agreedGross = "3000";
  const updated = await repository.updateQuote(saved.id, saved.revision, edit, exampleCatalog);
  expect(updated.createdAt).toBe(saved.createdAt);
  expect(updated.revision).toBe(2);
  expect(updated.snapshot.totals.gross).toBe(300000);
  expect(updated.snapshot.product).toEqual(saved.snapshot.product);
  expect(updated.snapshot.gold.customerLots).toEqual(saved.snapshot.gold.customerLots);
  expect(updated.snapshot.stones).toEqual(saved.snapshot.stones);
  await expect(repository.updateQuote(saved.id, saved.revision, edit, exampleCatalog)).rejects.toBeInstanceOf(QuoteConflictError);
});


test("historyczne rozliczenie netto zachowuje ręcznie wpisaną masę przy edycji uwag", async () => {
  const draft = createEmptyQuote("2026-09-06");
  draft.customer.name = "Historyczne złoto";
  delete draft.gold.settlementVersion;
  Object.assign(draft.gold, { source: "mixed", ourMass: "1,5", purchasePerGram: "350", estimatedMass: "6,5", customerLots: [{ id: "a", fineness: "585", mass: "2" }] });
  const saved = await repository.create(draft, exampleCatalog);
  const edit = draftFromQuote(saved);
  edit.customer.notes = "Nowe ustalenia";
  const updated = await repository.updateQuote(saved.id, saved.revision, edit, exampleCatalog);
  expect(updated.snapshot.totals).toEqual(saved.snapshot.totals);
  expect(updated.snapshot.totals.gold.purchaseCost).toBe(52500);
  expect(updated.snapshot.gold.settlementVersion).toBeUndefined();
});
