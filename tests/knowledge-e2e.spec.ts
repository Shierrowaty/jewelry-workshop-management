import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { QUOTES_DATABASE_NAME } from "../src/features/quotes/data/database";
import type { KnowledgeEntry } from "../src/features/knowledge/types";

const origin = "http://127.0.0.1:3104";
async function startApp() {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3104"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Knowledge test server timeout: ${output}`)); }, 60_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    const read = (data: Buffer) => { output += data.toString(); if (output.includes("Ready in")) { clearTimeout(timer); resolve(); } };
    child.stdout.on("data", read); child.stderr.on("data", read);
  });
  return child;
}
async function stopApp(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit"); child.kill(); await exited;
}
async function readEntries(page: Page): Promise<KnowledgeEntry[]> {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction("knowledgeEntries", "readonly");
      const records = transaction.objectStore("knowledgeEntries").getAll();
      transaction.oncomplete = () => { database.close(); resolve(records.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), QUOTES_DATABASE_NAME);
}

test("Baza wiedzy: ręczne kategorie, kamienie i wyroby, filtry, edycja, archiwum, usuwanie i praca offline; wycena historyczna", async ({}, testInfo) => {
  await mkdir("test-results", { recursive: true });
  const profile = await mkdtemp(join(process.cwd(), "test-results", "knowledge-"));
  let server: ChildProcess | undefined, context: BrowserContext | undefined;
  const errors: string[] = [];
  async function launch(offline = false) {
    const browser = await chromium.launchPersistentContext(profile, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, locale: "pl-PL", viewport: { width: 1366, height: 900 }, offline });
    browser.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    browser.pages().forEach(page => page.on("pageerror", error => errors.push(error.message)));
    return browser;
  }
  try {
    server = await startApp(); context = await launch(); let page = context.pages()[0];
    await page.goto(origin);
    await page.getByRole("navigation", { name: "Menu główne" }).getByRole("link", { name: "Baza wiedzy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Baza wiedzy", exact: true })).toBeVisible();
    expect(await readEntries(page)).toEqual([]);
    await expect(page.getByRole("button", { name: "Dodaj rekord", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Nazwa grupy", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Działy Bazy wiedzy" })).toBeVisible();
    await page.getByRole("button", { name: "Zarządzaj bazą", exact: true }).click();
    for (const [name, department] of [["Szmaragdy", "stone"], ["Szafiry", "stone"], ["Bransoletki", "product"]]) {
      await page.getByLabel("Nazwa grupy", { exact: true }).fill(name);
      await page.getByLabel("Dział grupy", { exact: true }).selectOption(department);
      await page.getByRole("button", { name: "Dodaj grupę", exact: true }).click();
      await expect(page.getByLabel("Nazwa grupy", { exact: true })).toHaveValue("");
    }
    await page.getByRole("button", { name: "Wróć do katalogu", exact: true }).click();
    await page.getByRole("button", { name: "Dodaj rekord", exact: true }).click();
    await page.getByLabel("Grupa", { exact: true }).selectOption({ label: "Szmaragdy" });
    for (const [label, value] of [["Rodzaj / nazwa kamienia", "Szmaragd kolumbijski"], ["Dostawca", "Dostawca testowy"], ["Kształt", "Owal"], ["Wymiary", "5 × 4 mm"], ["Waga (ct)", "0,5"], ["Cena netto za karat", "2000"], ["Uwagi", "Zielony kamień"], ["Data wpisu", "2020-05-06"]]) await page.getByLabel(label, { exact: true }).fill(value);
    await expect(page.getByRole("region", { name: "Nowy rekord", exact: true })).toContainText(/Cena brutto kamienia1\s?230,00\sPLN/);
    await page.getByRole("button", { name: "Zapisz rekord", exact: true }).click();
    const stone = page.getByRole("article", { name: "Szmaragd kolumbijski", exact: true });
    await expect(stone).toBeVisible();
    await stone.getByText("Szczegóły rekordu", { exact: true }).click();
    await expect(stone).toContainText("06.05.2020"); await expect(stone).toContainText("5 × 4 mm");
    const [saved] = await readEntries(page);
    await stone.getByRole("button", { name: "Edytuj", exact: true }).click();
    await page.getByLabel("Sposób ceny", { exact: true }).selectOption("piece");
    await page.getByLabel("Cena netto za sztukę", { exact: true }).fill("600");
    await page.getByRole("button", { name: "Zapisz rekord", exact: true }).click();
    await expect(stone).toContainText("Cena brutto kamienia738,00 PLN");
    const [edited] = await readEntries(page); expect(edited.id).toBe(saved.id); expect(edited.createdAt).toBe(saved.createdAt); expect(edited.revision).toBe(2);
    await page.getByRole("button", { name: "Dodaj rekord", exact: true }).click();
    await page.getByLabel("Dział", { exact: true }).selectOption("product");
    await page.getByLabel("Grupa", { exact: true }).selectOption({ label: "Bransoletki" });
    for (const [label, value] of [["Nazwa produktu", "Bransoletka młotkowana"], ["Waga referencyjna", "10,123"], ["Próba złota", "585"], ["Kolor złota", "Żółte"], ["Cena złota za gram w momencie wpisu", "350"], ["Koszt materiału", "3400"], ["Cena wykonania / robocizny", "500"], ["Cena gotowego produktu", "4500"], ["Data wpisu", "2021-04-03"], ["Uwagi", "Cena referencyjna"]]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Zapisz rekord", exact: true }).click();
    const product = page.getByRole("article", { name: "Bransoletka młotkowana", exact: true });
    await expect(product).toBeVisible();
    await page.getByLabel("Szukaj w Bazie wiedzy", { exact: true }).fill("DOSTAWCA TESTOWY");
    await expect(stone).toBeVisible(); await expect(product).toHaveCount(0);
    await page.getByRole("button", { name: "Wyczyść filtry", exact: true }).click();
    await page.getByRole("navigation", { name: "Działy Bazy wiedzy" }).getByRole("button", { name: /Wyroby/ }).click();
    await expect(product).toHaveCount(0);
    await page.getByRole("button", { name: "Bransoletki", exact: true }).click();
    await expect(product).toBeVisible(); await expect(stone).toHaveCount(0);
    await page.getByLabel("Szukaj w Bazie wiedzy", { exact: true }).fill("DOSTAWCA TESTOWY");
    await expect(stone).toBeVisible(); await expect(product).toHaveCount(0);
    await page.getByRole("button", { name: "Wyczyść filtry", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("baza-wiedzy-laptop.png"), fullPage: true });
    await expect(stone.getByRole("button", { name: "Archiwizuj", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Zarządzaj bazą", exact: true }).click();
    await stone.getByRole("button", { name: "Archiwizuj", exact: true }).click(); await expect(stone).toHaveCount(0);
    await page.getByLabel("Widok rekordów", { exact: true }).selectOption("archived");
    await expect(stone).toBeVisible(); await stone.getByRole("button", { name: "Przywróć", exact: true }).click();
    await page.getByLabel("Widok rekordów", { exact: true }).selectOption("active"); await expect(stone).toBeVisible();
    page.once("dialog", dialog => dialog.dismiss()); await product.getByRole("button", { name: "Usuń", exact: true }).click(); await expect(product).toBeVisible();
    page.once("dialog", dialog => dialog.accept()); await product.getByRole("button", { name: "Usuń", exact: true }).click(); await expect(product).toHaveCount(0);
    const remaining = await readEntries(page); expect(remaining).toHaveLength(1);
    await page.goto(`${origin}/nowa-wycena`);
    await page.getByLabel("Imię i nazwisko", { exact: true }).fill("Klient sprzed lat");
    await page.getByLabel("Data wyceny", { exact: true }).fill("2018-03-14");
    await expect(page.getByText("Wycena historyczna", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Zapisz wycenę", exact: true }).click();
    await expect(page).toHaveURL(/\/realizacje\/[\da-f-]+$/);
    await expect(page.getByText("Wycena historyczna", { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText("Wycena historyczna", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Edytuj realizację", exact: true }).click();
    await expect(page.getByLabel("Data wyceny", { exact: true })).toHaveValue("2018-03-14");
    await page.getByRole("link", { name: "Wróć do szczegółów", exact: true }).click();
    await page.goto(`${origin}/realizacje`); await expect(page.getByText("Wycena historyczna", { exact: true })).toBeVisible();
    await page.goto(`${origin}/cenniki-i-ustawienia`);
    await expect(stone).toBeVisible(); expect(await readEntries(page)).toEqual(remaining);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true); await page.reload(); await expect(stone).toBeVisible();
    await stone.getByRole("button", { name: "Edytuj", exact: true }).click();
    await page.getByLabel("Uwagi", { exact: true }).fill("Zmienione offline");
    await page.getByRole("button", { name: "Zapisz rekord", exact: true }).click(); await expect(stone).toBeVisible();
    const offlineEntries = await readEntries(page); expect(offlineEntries[0].notes).toBe("Zmienione offline");
    await context.close(); context = await launch(true); page = context.pages()[0];
    await page.goto(`${origin}/cenniki-i-ustawienia`);
    await expect(page.getByRole("article", { name: "Szmaragd kolumbijski", exact: true })).toBeVisible();
    expect(await readEntries(page)).toEqual(offlineEntries);
    await expect(page.getByLabel("Nazwa grupy", { exact: true })).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("baza-wiedzy-telefon.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context?.close(); if (server) await stopApp(server); }
});

test("katalog: pierwszy rekord bez grupy, przypisanie, zmiana nazwy i powrót do katalogu na telefonie", async ({}, testInfo) => {
  const server = await startApp();
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "pl-PL" });
  try {
    await page.goto(`${origin}/cenniki-i-ustawienia`);
    await expect(page.getByRole("button", { name: "Dodaj rekord", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Dodaj rekord", exact: true }).click();
    await expect(page.getByLabel("Grupa", { exact: true })).toHaveValue("");
    await expect(page.getByText(/W dziale „Kamienie” nie ma jeszcze grup/)).toBeVisible();
    await page.getByLabel("Rodzaj / nazwa kamienia", { exact: true }).fill("Diament bez grupy");
    await page.getByRole("button", { name: "Zapisz rekord", exact: true }).click();
    const card = page.getByRole("article", { name: "Diament bez grupy", exact: true });
    await expect(card).toBeVisible();
    const [original] = await readEntries(page);
    await page.getByRole("navigation", { name: "Działy Bazy wiedzy" }).getByRole("button", { name: /Kamienie/ }).click();
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "Zarządzaj bazą", exact: true }).click();
    await page.getByLabel("Nazwa grupy", { exact: true }).fill("Diamenty");
    await page.getByRole("button", { name: "Dodaj grupę", exact: true }).click();
    await expect(page.getByLabel("Nazwa grupy", { exact: true })).toHaveValue("");
    await card.getByRole("button", { name: "Edytuj", exact: true }).click();
    await page.getByLabel("Grupa", { exact: true }).selectOption({ label: "Diamenty" });
    await page.getByRole("button", { name: "Zapisz rekord", exact: true }).click();
    await expect(card).toContainText("Diamenty");
    const assigned = await readEntries(page);
    expect(assigned[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, revision: 2 });
    await page.getByRole("button", { name: "Zmień nazwę grupy Diamenty", exact: true }).click();
    await page.getByLabel("Nazwa grupy", { exact: true }).fill("Diamenty naturalne");
    await page.getByRole("button", { name: "Zapisz nazwę", exact: true }).click();
    await expect(card).toContainText("Diamenty naturalne");
    expect(await readEntries(page)).toEqual(assigned);
    await page.getByRole("button", { name: "Wróć do katalogu", exact: true }).click();
    await page.getByRole("navigation", { name: "Działy Bazy wiedzy" }).getByRole("button", { name: /Kamienie/ }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("button", { name: "Diamenty naturalne", exact: true }).click();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Edytuj", exact: true }).click();
    await page.getByLabel("Grupa", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Zapisz rekord", exact: true }).click();
    await expect(card).toContainText("Bez grupy");
    await page.reload(); await expect(card).toBeVisible();
    await expect(page.getByLabel("Nazwa grupy", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("katalog-telefon.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath("katalog-laptop.png"), fullPage: true });
    const [template] = await readEntries(page);
    await page.evaluate(({ name, template }) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["knowledgeCategories", "knowledgeEntries"], "readwrite");
        const root = { id: crypto.randomUUID(), name: "Dawne materiały", parentId: null, createdAt: template.createdAt };
        const child = { id: crypto.randomUUID(), name: "Zielone", parentId: root.id, createdAt: template.createdAt };
        tx.objectStore("knowledgeCategories").add(root); tx.objectStore("knowledgeCategories").add(child);
        tx.objectStore("knowledgeEntries").add({ ...template, id: crypto.randomUUID(), name: "Dawny rekord", categoryId: root.id, subcategoryId: child.id });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), { name: QUOTES_DATABASE_NAME, template });
    const legacySnapshot = await readEntries(page);
    await page.reload();
    await page.getByRole("navigation", { name: "Działy Bazy wiedzy" }).getByRole("button", { name: /Kamienie/ }).click();
    await page.getByRole("button", { name: "Dawne materiały · Zielone", exact: true }).click();
    await expect(page.getByRole("article", { name: "Dawny rekord", exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(await readEntries(page)).toEqual(legacySnapshot);

  } finally { await browser.close(); await stopApp(server); }
});
