import { expect, test } from "@playwright/test";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { QuotesDatabase } from "../src/features/quotes/data/database";
import { CalculatorRepository } from "../src/features/calculator/repository";
import { createEmptyQuote } from "../src/features/quotes/defaults";
import { calculateQuote } from "../src/features/quotes/calculations";
import { changePricing } from "../src/features/quotes/pricing-draft";
let factory: IDBFactory, db: QuotesDatabase, repository: CalculatorRepository;
test.beforeEach(() => { factory = new IDBFactory(); db = new QuotesDatabase("calculator", { indexedDB: factory, IDBKeyRange }); repository = new CalculatorRepository(db); });
test.afterEach(() => db.close());
function draft() {
  const result = createEmptyQuote("2020-02-29"); result.product.weight = "3"; result.gold.purchasePerGram = "100";
  result.stones = [{id:"stone",name:"Szmaragd",quantity:"2",carats:"0,5",shape:"Owal",dimensions:"5 × 4 mm",priceBasis:"carat",purchasePrice:"2000",plannedProfit:"",customerOwned:false}];
  return changePricing(result,"cleanProfit","880");
}
test("zapis, restart i edycja zachowują nazwę, wszystkie pola i identyfikator", async () => {
  const input = draft(); const saved = await repository.save(" Próba ",input); input.stones[0].shape = "zmiana poza bazą";
  expect(saved.name).toBe("Próba"); db.close(); db = new QuotesDatabase("calculator",{indexedDB:factory,IDBKeyRange});repository=new CalculatorRepository(db);
  expect((await repository.list())[0]).toEqual(saved);
  const updated=await repository.save("Nowa nazwa",changePricing(saved.draft,"gross","2460"),saved);
  expect(updated.id).toBe(saved.id); expect(updated.createdAt).toBe(saved.createdAt); expect(updated.revision).toBe(2);
  expect(updated.draft.stones[0].shape).toBe("Owal");expect(await db.quotes.count()).toBe(0);expect(await db.knowledgeEntries.count()).toBe(0);
});
test("wspólny kalkulator: cena i zysk zmieniają kierunek bez utraty kosztów", () => {
  const input=draft();expect(calculateQuote(input).totals).toMatchObject({totalCost:130000,net:230000,vat:52900,gross:282900,profit:100000,estimatedTax:12000,cleanProfit:88000});
  expect(calculateQuote(changePricing(input,"gross","2460")).totals).toMatchObject({totalCost:130000,net:200000,vat:46000,cleanProfit:61600});
  expect(calculateQuote(changePricing(input,"gross","123")).totals).toMatchObject({profit:-120000,estimatedTax:0,cleanProfit:-120000});
});
test("transfer jest odrębnym trwałym szkicem; zachowuje pełne finanse i oba kierunki ceny", async () => {
  for (const input of [draft(),changePricing(draft(),"gross","2460")]) {
    input.customer.name="Nie przenoś klienta"; input.customer.notes="Prywatne";
    input.otherCosts=[{id:"cost",name:"Opakowanie",amount:"25"}];
    const saved=await repository.save("Pierścionek",input), transfer=await repository.transfer(saved.name,saved.draft);
    expect(transfer.draft.customer.name).toBe("");expect(transfer.draft.customer.notes).toBe("");expect(transfer.draft.product.customName).toBe("Pierścionek");
    expect(calculateQuote(transfer.draft)).toEqual(calculateQuote(input));expect(transfer.draft.gold).toEqual(input.gold);expect(transfer.draft.stones).toEqual(input.stones);
    input.stones[0].carats="999"; expect((await db.calculationTransfers.get(transfer.id))!.draft.stones[0].carats).toBe("0,5");
    expect(await repository.get(saved.id)).toEqual(saved);
  }
  expect(await db.quotes.count()).toBe(0); expect(await db.calculationTransfers.count()).toBe(2);
});
test("złoto klienta i mieszane: wspólne przeliczenie wielu prób oraz progu 3 g", async () => {
  for (const source of ["customer","mixed"] as const) for(const mass of ["3","3,001"]) {
    const input=draft();input.gold={...input.gold,source,estimatedMass:mass,customerLots:[{id:"a",fineness:"585",mass:"1"},{id:"b",fineness:"750",mass:"1"}]};
    const saved=await repository.save(`${source}-${mass}`,input), transfer=await repository.transfer(saved.name,saved.draft);
    expect(calculateQuote(transfer.draft)).toEqual(calculateQuote(input));expect(transfer.draft.gold.customerLots).toHaveLength(2);
    expect(calculateQuote(input).totals!.gold.purchaseCost).toBe(source==="customer"?0:mass==="3"?11679:10190);
  }
});
test("walidacja i kontrola rewizji blokują częściowy zapis i nadpisanie nowszej wersji", async () => {
  await expect(repository.save(" ",draft())).rejects.toThrow("nazwę"); const invalid=draft();invalid.gold.purchasePerGram="-1";
  await expect(repository.save("Błąd",invalid)).rejects.toThrow("Popraw");await expect(repository.transfer("Błąd",invalid)).rejects.toThrow("Popraw");
  expect(await db.calculations.count()).toBe(0);expect(await db.calculationTransfers.count()).toBe(0);
  const saved=await repository.save("Pierwsza",draft());await repository.save("Nowsza",saved.draft,saved);
  await expect(repository.save("Stara",saved.draft,saved)).rejects.toThrow("innym oknie");expect((await repository.get(saved.id))!.name).toBe("Nowsza");
});
test("migracja v8 do v9 zachowuje wszystkie dotychczasowe tabele", async () => {
  db.close();const old=new Dexie("calculator",{indexedDB:factory,IDBKeyRange});old.version(8).stores({quotes:"&id",knowledgeEntries:"&id",knowledgeSync:"&key",syncSettings:"&key"});
  const quote={id:"quote",snapshot:{custom:"preserved"}},knowledge={id:"knowledge",notes:"offline"},state={key:"state",inFlight:{payload:"pending"}},binding={key:"workspace",workspaceId:"old"};
  await old.table("quotes").put(quote);await old.table("knowledgeEntries").put(knowledge);await old.table("knowledgeSync").put(state);await old.table("syncSettings").put(binding);old.close();
  db=new QuotesDatabase("calculator",{indexedDB:factory,IDBKeyRange});await db.open();expect(db.verno).toBe(9);
  expect(await db.quotes.get("quote")).toEqual(quote);expect(await db.knowledgeEntries.get("knowledge")).toEqual(knowledge);expect(await db.knowledgeSync.get("state")).toEqual(state);expect(await db.syncSettings.get("workspace")).toEqual(binding);
  expect(await db.calculations.count()).toBe(0);expect(await db.calculationTransfers.count()).toBe(0);
});
