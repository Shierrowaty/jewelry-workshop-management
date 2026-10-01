import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { SavedCalculation, CalculationTransfer } from "../src/features/calculator/repository";
import type { SavedQuote } from "../src/features/quotes/data/types";
import { calculateQuote } from "../src/features/quotes/calculations";
const origin="http://127.0.0.1:3106";
async function startApp(){
  const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3106"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NEXT_TELEMETRY_DISABLED:"1"}});
  await new Promise<void>((resolve,reject)=>{let output="";const timer=setTimeout(()=>{child.kill();reject(new Error(output));},60000);child.once("error",e=>{clearTimeout(timer);reject(e);});child.once("exit",()=>{clearTimeout(timer);reject(new Error(output));});const read=(data:Buffer)=>{output+=data.toString();if(output.includes("Ready in")){clearTimeout(timer);resolve();}};child.stdout.on("data",read);child.stderr.on("data",read);});return child;
}
async function records<T>(page:Page,table:string):Promise<T[]> {
  return page.evaluate(table=>new Promise((resolve,reject)=>{const request=indexedDB.open("jewelry-workshop-demo");request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(table),read=tx.objectStore(table).getAll();tx.oncomplete=()=>{db.close();resolve(read.result);};tx.onabort=()=>{db.close();reject(tx.error);};};}),table);
}
test("Kalkulator: dwukierunkowe ceny, złoto, kamienie, zapis, edycja, restart offline i szkic wyceny",async({},testInfo)=>{
  await mkdir("test-results",{recursive:true});const profile=await mkdtemp(join(process.cwd(),"test-results","calculator-"));let server:ChildProcess|undefined,context:BrowserContext|undefined;const errors:string[]=[];
  async function launch(offline=false){const ctx=await chromium.launchPersistentContext(profile,{channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true,locale:"pl-PL",viewport:{width:1366,height:900},offline});ctx.pages().forEach(page=>page.on("pageerror",e=>errors.push(e.message)));ctx.on("page",page=>page.on("pageerror",e=>errors.push(e.message)));return ctx;}
  try{
    server=await startApp();context=await launch();let page=context.pages()[0];await page.goto(origin);
    const links=page.getByRole("navigation",{name:"Menu główne"}).getByRole("link");expect((await links.allTextContents()).slice(0,3)).toEqual(["Pulpit","Kalkulator","Nowa wycena"]);
    await page.getByRole("navigation",{name:"Menu główne"}).getByRole("link",{name:"Kalkulator",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Kalkulator",exact:true})).toBeVisible();
    const gold=()=>page.locator("details").filter({has:page.locator("summary",{hasText:/^Złoto$/})}).first();
    const stones=()=>page.locator("details").filter({has:page.locator("summary",{hasText:/^Kamienie$/})}).first();
    await expect(gold()).not.toHaveAttribute("open","");await expect(stones()).not.toHaveAttribute("open","");
    await page.getByRole("button",{name:"Zapisz kalkulację",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"Podaj nazwę kalkulacji."})).toBeVisible();
    await page.getByLabel("Nazwa kalkulacji",{exact:true}).fill("Pierścionek testowy");await page.getByLabel("Chcę czysto zarobić",{exact:true}).fill("880");await expect(page.getByLabel("Cena dla klienta brutto",{exact:true})).toHaveValue("1230,00");
    await gold().locator("summary").first().click();await page.getByLabel("Masa (g)",{exact:true}).fill("3");await page.getByLabel("Cena netto za gram",{exact:true}).fill("100");await expect(page.getByLabel("Cena dla klienta brutto",{exact:true})).toHaveValue("1599,00");
    await stones().locator("summary").first().click();await page.getByRole("button",{name:"Dodaj kamień",exact:true}).click();await page.getByLabel("Rodzaj / nazwa kamienia",{exact:true}).selectOption("emerald");
    await page.getByLabel("Ilość (szt.)",{exact:true}).fill("2");await page.getByLabel("Waga (karaty)",{exact:true}).fill("0,5");await page.getByLabel("Kształt",{exact:true}).fill("Owal");await page.getByLabel("Wymiary",{exact:true}).fill("5 × 4 mm");
    await page.getByLabel("Sposób naliczania ceny",{exact:true}).selectOption("carat");await page.getByLabel("Cena netto za karat",{exact:true}).fill("2000");await expect(stones()).toContainText(/Cena brutto kamienia1\s?230,00\sPLN/);await expect(page.getByLabel("Cena dla klienta brutto",{exact:true})).toHaveValue("2829,00");
    await page.getByLabel("Cena dla klienta brutto",{exact:true}).fill("2460");await expect(page.getByLabel("Chcę czysto zarobić",{exact:true})).toHaveValue("616,00");
    await page.getByLabel("Sposób naliczania ceny",{exact:true}).selectOption("piece");await page.getByLabel("Cena netto za sztukę",{exact:true}).fill("600");await expect(page.getByLabel("Chcę czysto zarobić",{exact:true})).toHaveValue("440,00");
    await page.getByLabel("Sposób naliczania ceny",{exact:true}).selectOption("carat");await page.getByLabel("Cena netto za karat",{exact:true}).fill("2000");
    await page.getByRole("button",{name:"Zapisz kalkulację",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Kalkulacja zapisana lokalnie"})).toBeVisible();const first=(await records<SavedCalculation>(page,"calculations"))[0];expect(await records(page,"quotes")).toEqual([]);
    await page.getByRole("link",{name:"Zapisane kalkulacje",exact:true}).click();await page.getByRole("article",{name:"Pierścionek testowy",exact:true}).getByRole("link",{name:"Edytuj",exact:true}).click();await expect(gold()).not.toHaveAttribute("open","");await expect(stones()).not.toHaveAttribute("open","");
    await gold().locator("summary").first().click();await page.getByRole("radio",{name:"Złoto klienta",exact:true}).check();
    for(let i=1;i<=2;i++){await page.getByRole("button",{name:"Dodaj kolejną próbę",exact:true}).click();await page.getByLabel(`Próba złota klienta ${i}`,{exact:true}).fill(i===1?"585":"750");await page.getByLabel(`Waga złota klienta ${i}`,{exact:true}).fill("1");}
    await page.getByLabel("Szacowana waga złota do wykonania zlecenia",{exact:true}).fill("3");await expect(gold()).toContainText("Brakuje 1,168 g złota próby 585");await expect(page.getByLabel("Chcę czysto zarobić",{exact:true})).toHaveValue("880,00");
    await page.getByRole("radio",{name:"Częściowo złoto klienta",exact:true}).check();await expect(page.getByLabel("Chcę czysto zarobić",{exact:true})).toHaveValue("777,22");
    await page.getByLabel("Chcę czysto zarobić",{exact:true}).fill("880");await expect(page.getByLabel("Cena dla klienta brutto",{exact:true})).toHaveValue("2603,65");
    await page.getByRole("button",{name:"Zapisz zmiany",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Kalkulacja zapisana lokalnie"})).toBeVisible();let saved=(await records<SavedCalculation>(page,"calculations"))[0];expect(saved.id).toBe(first.id);expect(saved.revision).toBe(2);
    await gold().locator("summary").first().click();await page.getByRole("heading",{name:"Kalkulator",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("kalkulator-laptop.png"),fullPage:true});
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    await context.close();context=await launch(true);page=context.pages()[0];await page.goto(`${origin}/kalkulator/${saved.id}`);await expect(page.getByLabel("Nazwa kalkulacji",{exact:true})).toHaveValue("Pierścionek testowy");await expect(gold()).not.toHaveAttribute("open","");
    await page.getByLabel("Nazwa kalkulacji",{exact:true}).fill("Kalkulacja offline");await page.getByRole("button",{name:"Zapisz zmiany",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Kalkulacja zapisana lokalnie"})).toBeVisible();saved=(await records<SavedCalculation>(page,"calculations"))[0];
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath("kalkulator-telefon.png"),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole("button",{name:"Przenieś do Nowej Wyceny",exact:true}).click();await expect(page).toHaveURL(/\/nowa-wycena\/z-kalkulatora\/[a-f0-9-]+$/);await expect(page.getByRole("heading",{name:"Nowa wycena",exact:true})).toBeVisible();
    const transfer=(await records<CalculationTransfer>(page,"calculationTransfers"))[0];expect(calculateQuote(transfer.draft)).toEqual(calculateQuote(saved.draft));expect(transfer.draft.gold).toEqual(saved.draft.gold);expect(transfer.draft.stones).toEqual(saved.draft.stones);expect(await records(page,"quotes")).toEqual([]);
    await page.reload();await expect(page.getByLabel("Cena dla klienta brutto",{exact:true})).toHaveValue("2603,65");await page.getByLabel("Imię i nazwisko",{exact:true}).fill("Klient ze szkicu");await page.getByRole("button",{name:"Zapisz wycenę",exact:true}).click();await expect(page).toHaveURL(/\/realizacje\/[a-f0-9-]+$/);
    const quote=(await records<SavedQuote>(page,"quotes"))[0];expect(quote.snapshot.totals).toEqual(calculateQuote(saved.draft).totals);expect(quote.snapshot.gold).toEqual({...saved.draft.gold,mass:saved.draft.product.weight,color:saved.draft.product.goldColor});expect(quote.snapshot.stones).toEqual(saved.draft.stones);expect((await records<SavedCalculation>(page,"calculations"))[0]).toEqual(saved);expect(errors).toEqual([]);
  }finally{await context?.close();if(server&&server.exitCode===null&&server.signalCode===null){const exited=once(server,"exit");server.kill();await exited;}}
});
