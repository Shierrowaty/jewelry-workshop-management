import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { QUOTES_DATABASE_NAME } from "../src/features/quotes/data/database";
import type { SavedQuote } from "../src/features/quotes/data/types";
import { addTestPhotos, expectPhotoCount, readPhotos, removeOnePhoto } from "./photo-scenario";

const origin = "http://127.0.0.1:3100";

// Own server process and own browser profile; never stop the user's dev server or clear their DB.
async function startApp(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"], {
    cwd: process.cwd(), windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Test server timeout: ${output}`)); }, 30_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Test server exited (${code}): ${output}`)); });
    const read = (data: Buffer) => {
      output += data.toString();
      if (output.includes("Ready in")) { clearTimeout(timeout); resolve(); }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
  });
  return child;
}

async function stopApp(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

async function readQuotes(page: Page): Promise<SavedQuote[]> {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("quotes", "readonly");
      const records = transaction.objectStore("quotes").getAll();
      transaction.oncomplete = () => { db.close(); resolve(records.result); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), QUOTES_DATABASE_NAME);
}

test("zapis, pełna edycja, zakończenie i przywrócenie przetrwają odświeżenie oraz restart", async ({}, testInfo) => {
  // Keep the Windows profile path short enough for Chromium's IndexedDB/LevelDB files.
  const profileRoot = join(process.cwd(), "test-results");
  await mkdir(profileRoot, { recursive: true });
  const profile = await mkdtemp(join(profileRoot, "photo-profile-"));
  const errors: string[] = [];
  const externalRequests: string[] = [];
  let server: ChildProcess | undefined;
  let context: BrowserContext | undefined;

  async function launch() {
    const browser = await chromium.launchPersistentContext(profile, {
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      headless: true, viewport: { width: 1366, height: 900 }, locale: "pl-PL",
    });
    await browser.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });
    const attach = (page: Page) => page.on("pageerror", (error) => errors.push(error.message));
    browser.pages().forEach(attach);
    browser.on("page", attach);
    return browser;
  }

  try {
    server = await startApp();
    context = await launch();
    let page = context.pages()[0];
    await page.goto(`${origin}/realizacje`);
    await expect(page.getByRole("heading", { name: "Jeszcze bez zapisanych wycen" })).toBeVisible();
    await page.goto(`${origin}/nowa-wycena`);
    await page.getByRole("button", { name: "Zapisz wycenę", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Podaj imię i nazwisko lub pseudonim" })).toBeVisible();
    await page.getByLabel("Pseudonim").fill("Test trwałości — profil izolowany");
    await page.getByLabel("Kanał kontaktu").selectOption("SMS");
    await page.getByLabel("Dane kontaktowe").fill("Kontakt testowy");
    await page.getByLabel("Uwagi", { exact: true }).fill("Pierwotne ustalenia");
    await page.getByLabel("Kategoria produktu").selectOption("rings");
    await page.getByLabel("Model / nazwa produktu").selectOption("ring-classic");
    await page.getByLabel("Krótki opis wariantu").fill("Matowe wykończenie");
    await page.getByLabel("Rozmiar", { exact: true }).fill("14");
    await page.getByLabel("Kanał kontaktu").selectOption("Facebook");
    await page.getByLabel("Kanał kontaktu").selectOption("Sklep");
    await page.getByLabel("Dwa kolory złota").check();
    await expect(page.getByLabel("Kolor złota", { exact: true })).toHaveCount(0);
    await page.getByLabel("Kolor 1 / element").fill("Szyna z żółtego złota");
    await page.getByLabel("Kolor 2 / element").fill("Oprawka z białego złota");
    await page.getByLabel("Waga produktu (g)").fill("błąd");
    await page.getByRole("button", { name: "Zapisz wycenę", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Popraw zaznaczone pola przed" })).toBeVisible();
    expect(await readQuotes(page)).toEqual([]);
    await page.getByLabel("Waga produktu (g)").fill("5,5");
    await page.getByLabel("Cena zakupu złota za gram").fill("350");
    await page.getByRole("button", { name: "Dodaj kamień", exact: true }).click();
    await page.getByLabel("Rodzaj / nazwa kamienia").selectOption("diamond");
    await page.getByLabel("Cena netto za sztukę").fill("200");
    const stonesSection = page.getByRole("region", { name: "Kamienie", exact: true });
    await expect(stonesSection).toContainText("Cena netto kamienia200,00 PLN");
    await expect(stonesSection).toContainText("VAT 23%46,00 PLN");
    await expect(stonesSection).toContainText("Cena brutto kamienia246,00 PLN");
    await page.getByLabel("Chcę czysto zarobić").fill("4158");
    const costs = page.getByRole("region", { name: "Inne koszty", exact: true });
    for (const [index, name, amount] of [[0, "Wysyłka", "25"], [1, "Pudełko", "10"]] as const) {
      await costs.getByRole("button", { name: "Dodaj pozycję" }).click();
      await costs.getByLabel("Nazwa pozycji").nth(index).fill(name);
      await costs.getByLabel("Kwota netto").nth(index).fill(amount);
    }
    await expect(page.getByLabel("Waga produktu — z sekcji Produkt")).toHaveValue("5,5");
    await expect(page.getByLabel("Cena dla klienta brutto", { exact: true })).toHaveValue("8468,55");
    await page.getByLabel("Cena dla klienta brutto", { exact: true }).fill("8468.55");
    await expect(page.getByLabel("Chcę czysto zarobić")).toHaveValue("4158,00");
    await page.getByLabel("Chcę czysto zarobić").fill("4158");
    await page.getByLabel("Ilość (szt.)").fill("3");
    await page.getByLabel("Waga (karaty)").fill("0,5");
    await page.getByLabel("Sposób naliczania ceny").selectOption("carat");
    await page.getByLabel("Cena netto za karat", { exact: true }).fill("400");
    await page.getByLabel("Kształt", { exact: true }).fill("Owal");
    await page.getByLabel("Wymiary", { exact: true }).fill("5 × 4 mm");
    await expect(page.getByLabel("Cena dla klienta brutto", { exact: true })).toHaveValue("8468,55");
    await page.getByLabel("Sposób naliczania ceny").selectOption("piece");
    await page.getByLabel("Ilość (szt.)").fill("1");
    await page.getByLabel("Cena netto za sztukę", { exact: true }).fill("200");
    await page.getByLabel("Częściowo złoto klienta", { exact: true }).check();
    await page.getByRole("button", { name: "Dodaj kolejną próbę", exact: true }).click();
    await page.getByLabel("Waga złota klienta 1", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Dodaj kolejną próbę", exact: true }).click();
    await page.getByLabel("Próba złota klienta 2", { exact: true }).fill("750");
    await page.getByLabel("Waga złota klienta 2", { exact: true }).fill("1");
    await page.getByLabel("Szacowana waga złota do wykonania zlecenia", { exact: true }).fill("3");
    await expect(page.getByRole("region", { name: "Złoto", exact: true })).toContainText(/58,78/);
    const goldSection = page.getByRole("region", { name: "Złoto", exact: true });
    await expect(goldSection).toContainText("15% · 0,450 g");
    await expect(goldSection.getByRole("status")).toHaveText("Brakuje 0,168 g złota próby 585");
    await expect(goldSection.getByText("Średnia próba", { exact: true })).not.toBeVisible();
    await goldSection.getByText("Szczegóły przeliczenia złota", { exact: true }).click();
    await expect(goldSection.getByText("Średnia próba", { exact: true })).toBeVisible();
    await page.getByLabel("Szacowana waga złota do wykonania zlecenia", { exact: true }).fill("3,001");
    await expect(goldSection).toContainText("10% · 0,300 g");
    await page.getByLabel("Złoto klienta", { exact: true }).check();
    await expect(goldSection).toContainText("0,00 PLN");
    await page.getByLabel("Nasze złoto", { exact: true }).check();
    await expect(page.getByLabel("Cena dla klienta brutto", { exact: true })).toHaveValue("8468,55");
    const summary = page.getByRole("region", { name: "Podsumowanie wyceny", exact: true });
    await expect(summary.getByText("Szyna z żółtego złota", { exact: true })).toBeVisible();
    await expect(summary.getByText("Oprawka z białego złota", { exact: true })).toBeVisible();
    await summary.getByText("Klient i produkt — dane zlecenia", { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("wycena-nowa-logika.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Zapisz wycenę", exact: true }).click();
    await expect(page).toHaveURL(/\/realizacje\/[\da-f-]+$/);
    await expect(page.getByText("Wycena zapisana lokalnie na tym urządzeniu.", { exact: true })).toBeVisible();
    const [original] = await readQuotes(page);
    expect((await readQuotes(page))).toHaveLength(1);
    expect(original.snapshot.customer).toMatchObject({ name: "", nickname: "Test trwałości — profil izolowany" });
    expect(original.snapshot.product).toMatchObject({ size: "14", twoColors: true, colorOne: "Szyna z żółtego złota", colorTwo: "Oprawka z białego złota" });
    expect(original.snapshot.stones[0]).toMatchObject({ carats: "0,5", shape: "Owal", dimensions: "5 × 4 mm" });
    expect(original.snapshot.totals).toMatchObject({ gross: 846855, net: 688500, vat: 158355, plannedProfit: 472500 });
    const productSummary = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Podsumowanie produktu$/ }) });
    await expect(productSummary).toContainText("5 × 4 mm");
    await expect(productSummary).toContainText("Pierwotne ustalenia");
    await productSummary.locator("summary").click();
    await expect(productSummary.getByText("Pierwotne ustalenia", { exact: true })).not.toBeVisible();
    await productSummary.locator("summary").click();
    const originalPhotos = await addTestPhotos(page);
    expect(await readQuotes(page)).toEqual([original]);
    await page.getByRole("region", { name: "Zdjęcia realizacji", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("zdjecia-laptop.png") });
    await page.reload();
    await expectPhotoCount(page, 3);
    expect(await readPhotos(page)).toEqual(originalPhotos);
    await expect(page.getByLabel("Uwagi", { exact: true })).toHaveValue("Pierwotne ustalenia");
    expect(await readQuotes(page)).toEqual([original]);
    await page.screenshot({ path: testInfo.outputPath("szczegoly-laptop.png") });

    await context.close();
    context = undefined;
    await stopApp(server);
    server = await startApp();
    context = await launch();
    page = context.pages()[0];
    await page.goto(`${origin}/realizacje`);
    const records = page.getByRole("list", { name: "Zapisane wyceny" }).getByRole("link");
    await expect(records).toHaveCount(1);
    await expect(records.first()).toContainText(/8\s?468,55\sPLN/);
    await expect(records.first()).toContainText("Klasyczny z jednym kamieniem");
    await page.screenshot({ path: testInfo.outputPath("realizacje-laptop.png") });
    await records.first().click();
    await expectPhotoCount(page, 3);
    expect(await readPhotos(page)).toEqual(originalPhotos);
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("Wycena");

    const otherTab = await context.newPage();
    await otherTab.goto(page.url());
    await otherTab.getByLabel("Uwagi", { exact: true }).fill("Niezapisane uwagi drugiej karty");
    await page.getByLabel("Status", { exact: true }).selectOption("W produkcji");
    await page.getByLabel("Termin wykonania (opcjonalny)").fill("2026-10-15");
    await page.getByLabel("Uwagi", { exact: true }).fill("Zmienione ustalenia");
    await page.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
    await expect(page.getByText("Zmiany zostały zapisane lokalnie.", { exact: true })).toBeVisible();
    await expect(otherTab.getByText("W bazie jest nowsza wersja zamówienia.", { exact: false })).toBeVisible();
    await expect(otherTab.getByLabel("Uwagi", { exact: true })).toHaveValue("Niezapisane uwagi drugiej karty");
    await expect(otherTab.getByRole("button", { name: "Zapisz zmiany", exact: true })).toBeDisabled();
    await otherTab.getByRole("button", { name: "Wczytaj aktualne dane" }).click();
    await expect(otherTab.getByLabel("Uwagi", { exact: true })).toHaveValue("Zmienione ustalenia");
    await page.reload();
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("W produkcji");
    await expect(page.getByLabel("Termin wykonania (opcjonalny)")).toHaveValue("2026-10-15");
    await expect(page.getByLabel("Uwagi", { exact: true })).toHaveValue("Zmienione ustalenia");
    const [updated] = await readQuotes(page);
    expect(updated.snapshot).toEqual(original.snapshot);
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.updatedAt > original.updatedAt).toBe(true);
    expect(updated.revision).toBe(2);
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("szczegoly-1280.png") });
    await page.goto(`${origin}/realizacje`);
    await expect(page.getByRole("list", { name: "Zapisane wyceny" })).toContainText("W produkcji");
    expect(await readQuotes(page)).toEqual([updated]);

    await otherTab.close();
    await page.getByRole("list", { name: "Zapisane wyceny" }).getByRole("link").click();
    await page.getByRole("link", { name: "Edytuj realizację", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/realizacje/${original.id}/edytuj$`));
    await expect(page.getByLabel("Waga produktu (g)")).toHaveValue("5,5");
    await expect(page.getByLabel("Cena zakupu złota za gram")).toHaveValue("350");
    await expect(page.getByLabel("Cena netto za sztukę")).toHaveValue("200");
    await expect(page.getByRole("button", { name: "Zapisz zmiany", exact: true })).toBeDisabled();
    expect(await readQuotes(page)).toEqual([updated]);
    await page.getByLabel("Waga produktu (g)").fill("6");
    await page.getByLabel("Cena netto za sztukę").fill("250");
    await page.getByLabel("Chcę czysto zarobić").fill("4400");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("niezapisane zmiany");
      await dialog.dismiss();
    });
    await page.getByRole("link", { name: "Wróć do szczegółów" }).click();
    await expect(page).toHaveURL(/\/edytuj$/);
    await expect(page.getByLabel("Waga produktu (g)")).toHaveValue("6");
    await page.screenshot({ path: testInfo.outputPath("edycja-realizacji.png") });
    await page.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/realizacje/${original.id}$`));
    await page.reload();
    await expect(page.getByText("Wycena zapisana lokalnie na tym urządzeniu.", { exact: true })).toBeVisible();
    const [edited] = await readQuotes(page);
    await expectPhotoCount(page, 3);
    expect(await readPhotos(page)).toEqual(originalPhotos);
    expect(edited).toMatchObject({ id: original.id, createdAt: original.createdAt, revision: 3, completedAt: null, syncStatus: "pending" });
    expect(edited.updatedAt > updated.updatedAt).toBe(true);
    expect(edited.snapshot).toMatchObject({ gold: { mass: "6", purchasePerGram: "350" }, stones: [{ purchasePrice: "250" }], totals: { gross: 908355, net: 738500, vat: 169855, plannedProfit: 500000, cleanProfit: 440000 } });
    expect(edited.snapshot.pricing).toMatchObject({ basis: "cleanProfit", desiredCleanProfit: "4400" });
    expect(await readQuotes(page)).toHaveLength(1);

    await page.getByRole("link", { name: "Edytuj realizację", exact: true }).click();
    await expect(page.getByLabel("Waga produktu (g)")).toHaveValue("6");
    await expect(page.getByLabel("Cena netto za sztukę")).toHaveValue("250");
    await page.getByLabel("Uwagi", { exact: true }).fill("Nie nadpisuj tych niezapisanych uwag");
    const concurrent = await context.newPage();
    await concurrent.goto(`${origin}/realizacje/${original.id}`);
    await concurrent.getByLabel("Status", { exact: true }).selectOption("Gotowe");
    await concurrent.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
    await expect(concurrent.getByText("Zmiany zostały zapisane lokalnie.", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Edytuj realizację", exact: true }).getByRole("alert")).toContainText("nowsza wersja realizacji");
    await expect(page.getByRole("button", { name: "Zapisz zmiany", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Uwagi", { exact: true })).toHaveValue("Nie nadpisuj tych niezapisanych uwag");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Wczytaj aktualne dane" }).click();
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("Gotowe");
    await expect(page.getByLabel("Uwagi", { exact: true })).toHaveValue("Zmienione ustalenia");
    await page.getByRole("link", { name: "Wróć do szczegółów" }).click();
    await concurrent.close();
    const [beforeCompletion] = await readQuotes(page);
    expect(beforeCompletion.completedAt).toBeNull();
    expect(beforeCompletion.revision).toBe(4);

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Zakończ realizację", exact: true }).click();
    expect(await readQuotes(page)).toEqual([beforeCompletion]);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Zakończ realizację", exact: true }).click();
    await expect(page.getByText("Realizacja została zakończona i zapisana lokalnie.", { exact: false })).toBeVisible();
    const [completed] = await readQuotes(page);
    expect(completed.completedAt).toBe(completed.updatedAt);
    expect(completed.revision).toBe(5);
    expect(completed.status).toBe("Gotowe");
    expect(completed.snapshot).toEqual(edited.snapshot);
    await expectPhotoCount(page, 3);
    expect(await readPhotos(page)).toEqual(originalPhotos);
    await page.getByRole("link", { name: "Wróć do realizacji", exact: true }).click();
    await expect(page.getByRole("button", { name: "Aktywne", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Brak aktywnych realizacji" })).toBeVisible();
    await page.getByRole("button", { name: "Zakończone", exact: true }).click();
    await expect(page.getByRole("list", { name: "Zapisane wyceny" }).getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Zapisane wyceny" })).toContainText("Data zakończenia:");
    await page.screenshot({ path: testInfo.outputPath("zakonczone-realizacje.png") });
    await page.getByRole("list", { name: "Zapisane wyceny" }).getByRole("link").click();
    await expect(page.getByRole("link", { name: "Edytuj realizację", exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Przywróć do aktywnych", exact: true }).click();
    await expect(page.getByText("Realizacja została przywrócona do aktywnych i zapisana lokalnie.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Zakończ realizację", exact: true })).toBeVisible();
    const [restored] = await readQuotes(page);
    expect(restored).toMatchObject({ id: original.id, createdAt: original.createdAt, completedAt: null, revision: 6, syncStatus: "pending", status: "Gotowe" });
    expect(restored.snapshot).toEqual(edited.snapshot);
    await context.close();
    context = await launch();
    page = context.pages()[0];
    await page.goto(`${origin}/realizacje`);
    await expect(page.getByRole("list", { name: "Zapisane wyceny" }).getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Zapisane wyceny" })).toContainText(/9\s?083,55\sPLN/);
    expect(await readQuotes(page)).toEqual([restored]);
    await page.getByRole("list", { name: "Zapisane wyceny" }).getByRole("link").click();
    await expectPhotoCount(page, 3);
    expect(await readPhotos(page)).toEqual(originalPhotos);
    await removeOnePhoto(page);
    expect(await readQuotes(page)).toEqual([restored]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("region", { name: "Zdjęcia realizacji", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("zdjecia-telefon.png") });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.getByRole("link", { name: "Wróć do realizacji", exact: true }).click();
    await page.getByRole("button", { name: "Zakończone", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Brak zakończonych realizacji" })).toBeVisible();
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  } finally {
    await context?.close();
    if (server) await stopApp(server);
  }
});


test("rozliczenie wielu prób przetrwa zapis, odświeżenie i edycję realizacji", async ({}, testInfo) => {
  const server = await startApp();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "pl-PL" });
    await page.goto(`${origin}/nowa-wycena`);
    await page.getByLabel("Pseudonim").fill("Rozliczenie Au");
    await page.getByLabel("Projekt indywidualny", { exact: true }).check();
    await page.getByLabel("Model / nazwa produktu").fill("Pierścionek testowy");
    await page.getByLabel("Waga produktu (g)").fill("3");
    await page.getByLabel("Częściowo złoto klienta", { exact: true }).check();
    await page.getByLabel("Cena zakupu złota za gram").fill("350");
    for (const [index, fineness, mass] of [[1, "585", "2"], [2, "750", "1"]] as const) {
      await page.getByRole("button", { name: "Dodaj kolejną próbę", exact: true }).click();
      await page.getByLabel(`Próba złota klienta ${index}`, { exact: true }).fill(fineness);
      await page.getByLabel(`Waga złota klienta ${index}`, { exact: true }).fill(mass);
    }
    await page.getByLabel("Szacowana waga złota do wykonania zlecenia", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Zapisz wycenę", exact: true }).click();
    await expect(page).toHaveURL(/\/realizacje\/[\da-f-]+$/);
    const summary = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Podsumowanie produktu$/ }) });
    await expect(summary).toContainText("Brakuje złota");
    await expect(summary).toContainText("0,168 g");
    await expect(summary).toContainText("3,282 g");
    const [saved] = await readQuotes(page);
    expect(saved.snapshot.gold.settlementVersion).toBe("fine-au-v1");
    expect(saved.snapshot.totals.gold.purchaseCost).toBe(5878);
    await page.reload();
    await expect(summary).toContainText("15% · 0,450 g");
    expect(await readQuotes(page)).toEqual([saved]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("rozliczenie-zlota-telefon.png"), fullPage: true });
    await page.getByRole("link", { name: "Edytuj realizację", exact: true }).click();
    await page.getByLabel("Waga złota klienta 1", { exact: true }).fill("4");
    await page.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
    await expect(page).toHaveURL(/\/realizacje\/[\da-f-]+$/);
    await expect(summary).toContainText("Pozostaje klientowi");
    await expect(summary).toContainText("1,832 g");
    expect((await readQuotes(page))[0].snapshot.totals.gold.purchaseCost).toBe(0);
  } finally {
    await browser?.close();
    await stopApp(server);
  }
});
