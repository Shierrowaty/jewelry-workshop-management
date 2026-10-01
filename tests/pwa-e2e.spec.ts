import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { QUOTES_DATABASE_NAME } from "../src/features/quotes/data/database";
import type { SavedQuote } from "../src/features/quotes/data/types";
import { addTestPhotos, expectPhotoCount, readPhotos } from "./photo-scenario";

const origin = "http://127.0.0.1:3102";
async function startBackend() {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3103"], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`PWA server timeout: ${output}`)); }, 60_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    const read = (data: Buffer) => { output += data.toString(); if (output.includes("Ready in")) { clearTimeout(timer); resolve(); } };
    child.stdout.on("data", read); child.stderr.on("data", read);
  });
  return child;
}
async function stopBackend(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit"); child.kill(); await exited;
}
async function quotes(page: Page): Promise<SavedQuote[]> {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("quotes", "readonly"), all = tx.objectStore("quotes").getAll();
      tx.oncomplete = () => { db.close(); resolve(all.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), QUOTES_DATABASE_NAME);
}
async function cacheUrls(page: Page) {
  return page.evaluate(async () => {
    const result: string[] = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) result.push(request.url);
    return result;
  });
}

test("PWA: rejestracja, bezpieczna aktualizacja, restart i pełna lokalna praca offline", async ({}, testInfo) => {
  await mkdir("test-results", { recursive: true });
  const profile = await mkdtemp(join(process.cwd(), "test-results", "pwa-"));
  let context: BrowserContext | undefined, backend: ChildProcess | undefined, proxy: Server | undefined;
  let nextVersion = false;
  const errors: string[] = [];
  const workerSource = await readFile("public/sw.js", "utf8");
  const launch = async (offline = false) => {
    const value = await chromium.launchPersistentContext(profile, {
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, offline,
      viewport: { width: 1366, height: 900 }, locale: "pl-PL",
    });
    await value.addInitScript(() => {
      const state = { documentId: Math.random().toString(36), syncStarts: 0 };
      Object.defineProperty(window, "__releaseNavigation", { value: state });
      const add = window.addEventListener.bind(window);
      window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === "quotes:saved-locally") state.syncStarts++;
        add(type, listener, options);
      }) as typeof window.addEventListener;
    });
    // All cloud traffic is intercepted; real accounts and user profiles are never used.
    await value.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const attach = (page: Page) => page.on("pageerror", error => errors.push(error.message));
    value.pages().forEach(attach); value.on("page", attach);
    return value;
  };
  try {
    backend = await startBackend();
    // A test-only proxy serves two worker versions without modifying build/user files.
    proxy = createServer(async (request, response) => {
      if (request.url === "/sw.js") {
        response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" });
        response.end(nextVersion ? workerSource.replace(/const VERSION = "[^"]+"/, 'const VERSION = "pwa-e2e-update"') : workerSource);
        return;
      }
      try {
        const remote = await fetch(`http://127.0.0.1:3103${request.url}`, { headers: Object.fromEntries(Object.entries(request.headers).filter(([key, value]) => key !== "host" && typeof value === "string")) as Record<string, string> });
        const headers = Object.fromEntries(remote.headers);
        delete headers["content-encoding"]; delete headers["content-length"];
        response.writeHead(remote.status, headers);
        response.end(Buffer.from(await remote.arrayBuffer()));
      } catch { response.writeHead(503); response.end("Test backend stopped"); }
    });
    proxy.listen(3102, "127.0.0.1"); await once(proxy, "listening");
    context = await launch();
    let page = context.pages()[0];
    await page.goto(origin);
    await expect(page.getByText("Aplikacja gotowa do pracy offline na tym urządzeniu.", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href)).json());
    expect(manifest).toMatchObject({ name: "Pracownia Demo", display: "standalone", start_url: "/", scope: "/" });

    // Release blocker check: online Link transitions must preserve the document
    // and the shared SyncController. Timings are evidence, not a flaky CI gate.
    const identity = () => page.evaluate(() => (window as unknown as { __releaseNavigation: { documentId: string; syncStarts: number } }).__releaseNavigation);
    const beforeNavigation = await identity();
    expect(beforeNavigation.syncStarts).toBe(1);
    const documentRequests: string[] = [], fallbackResponses: string[] = [];
    page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url()); });
    page.on("response", response => { if (response.headers()["x-jwm-offline-shell"]) fallbackResponses.push(response.url()); });
    const timings: { path: string; elapsedMs: number }[] = [];
    for (const [name, path] of [["Nowa wycena", "/nowa-wycena"], ["Realizacje", "/realizacje"], ["Pulpit", "/"], ["Nowa wycena", "/nowa-wycena"], ["Realizacje", "/realizacje"], ["Pulpit", "/"]]) {
      const started = performance.now();
      await page.getByRole("navigation", { name: "Menu g\u0142\u00f3wne" }).getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      timings.push({ path, elapsedMs: Math.round(performance.now() - started) });
      expect(await identity()).toEqual(beforeNavigation);
    }
    expect(documentRequests).toEqual([]);
    expect(fallbackResponses).toEqual([]);
    await testInfo.attach("online-navigation", { body: JSON.stringify({ timings, documentRequests, fallbackResponses, syncStarts: beforeNavigation.syncStarts }, null, 2), contentType: "application/json" });
    console.log("Online navigation (ms):", timings.map(item => `${item.path}: ${item.elapsedMs}`).join(", "));

    // No automatic reload while a new/unsaved quote is being edited.
    await page.goto(`${origin}/nowa-wycena`);
    await page.getByLabel("Imię i nazwisko").fill("Niezapisany szkic PWA");
    nextVersion = true;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(page.getByText("Dostępna jest nowa wersja aplikacji", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Imię i nazwisko")).toHaveValue("Niezapisany szkic PWA");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "Zaktualizuj", exact: true }).click();
    await expect(page.getByLabel("Imię i nazwisko")).toHaveValue("Niezapisany szkic PWA");
    const another = await context.newPage(); await another.goto(origin);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Zaktualizuj", exact: true }).click();
    await expect(page.getByText(/Zamknij pozostałe karty/)).toBeVisible();
    await another.close();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Zaktualizuj", exact: true }).click();
    await expect(page.getByLabel("Imię i nazwisko")).toHaveValue("");
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes("jwm-ui-pwa-e2e-update"))).toBe(true);
    await expect(page.getByText("Dostępna jest nowa wersja aplikacji", { exact: true })).toHaveCount(0);

    // Exercise cloud paths through a real controlled page with synthetic responses.
    await context.route("https://pwa-fixture.supabase.co/**", route => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"synthetic":"never-cache-this"}' }));
    await page.evaluate(async () => {
      for (const path of ["auth/v1/token", "rest/v1/quotes", "storage/v1/object/photos/example"]) await (await fetch(`https://pwa-fixture.supabase.co/${path}`)).text();
    });
    const urls = await cacheUrls(page);
    expect(urls.length).toBeGreaterThan(10);
    expect(urls.every(url => new URL(url).origin === origin && /^(\/_next\/static\/|\/pwa\/|\/offline$|\/manifest.webmanifest$)/.test(new URL(url).pathname))).toBe(true);

    // Restore a real SDK session offline, with synthetic Auth responses only.
    const user = { id: "40000000-0000-4000-8000-000000000001", email: "Demo@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" };
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: user.id, exp: expiry, role: "authenticated" })).toString("base64url"), Buffer.from("pwa-isolated-signature").toString("base64url")].join(".");
    await context.route("**/auth/v1/**", route => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(route.request().url().includes("/token") ? { access_token: token, refresh_token: "pwa-isolated-refresh", token_type: "bearer", expires_in: 3600, expires_at: expiry, user } : user) }));
    await page.goto(`${origin}/logowanie`);
    await page.getByLabel("E-mail", { exact: true }).fill(user.email);
    await page.getByLabel("Has\u0142o", { exact: true }).fill("pwa-isolated-password");
    await page.getByRole("button", { name: "Zaloguj si\u0119", exact: true }).click();
    await expect(page.getByRole("region", { name: "Panel u\u017cytkownika" })).toContainText("Witaj, Demo");
    const sessionBefore = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /^sb-.*-auth-token$/.test(key)));
    expect(sessionBefore).toHaveLength(1);

    // First actual saved record is created fully offline; its ID was never requested online.
    await stopBackend(backend); backend = undefined;
    await context.setOffline(true);
    const offlineResponse = await page.goto(`${origin}/nowa-wycena`);
    expect(offlineResponse?.fromServiceWorker()).toBe(true);
    expect(offlineResponse?.headers()["x-jwm-offline-shell"]).toBe("1");
    await page.getByLabel("Imię i nazwisko").fill("Realizacja offline PWA");
    await page.getByLabel("Waga produktu (g)").fill("5,5");
    await page.getByLabel("Cena zakupu złota za gram").fill("350");
    await page.getByRole("button", { name: "Zapisz wycenę", exact: true }).click();
    await expect(page).toHaveURL(/\/realizacje\/[\da-f-]+$/);
    await expect(page.getByRole("link", { name: "Edytuj realizację", exact: true })).toBeVisible();
    const [created] = await quotes(page);
    expect(created.snapshot.gold.mass).toBe("5,5");
    const photos = await addTestPhotos(page);
    await page.getByRole("link", { name: "Edytuj realizację", exact: true }).click();
    await expect(page.getByLabel("Waga produktu (g)")).toHaveValue("5,5");
    await page.getByLabel("Waga produktu (g)").fill("6");
    await page.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/realizacje/${created.id}$`));
    const [edited] = await quotes(page);
    expect(edited).toMatchObject({ createdAt: created.createdAt, revision: created.revision + 1, syncStatus: "pending", snapshot: { gold: { mass: "6", purchasePerGram: "350" } } });
    await expectPhotoCount(page, 3);
    await page.reload();
    expect(await quotes(page)).toEqual([edited]);
    await context.close(); context = undefined;
    if (backend) { await stopBackend(backend); backend = undefined; }
    // Browser restarts with networking already disabled AND the Next server stopped.
    context = await launch(true); page = context.pages()[0];
    await page.goto(`${origin}/realizacje`);
    const record = page.getByRole("list", { name: "Zapisane wyceny" }).getByRole("link");
    await expect(record).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Panel u\u017cytkownika" })).toContainText("Witaj, Demo");
    expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /^sb-.*-auth-token$/.test(key)))).toEqual(sessionBefore);
    await record.click();
    await expectPhotoCount(page, 3);
    expect(await readPhotos(page)).toEqual(photos);
    expect(await quotes(page)).toEqual([edited]);
    await page.getByRole("button", { name: "Otwórz zdjęcie: maly-detal.png" }).click();
    await expect.poll(() => page.getByRole("dialog").getByRole("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Edytuj realizację", exact: true }).click();
    await expect(page.getByLabel("Waga produktu (g)")).toHaveValue("6");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("pwa-offline-mobile.png") });
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy!.close(() => resolve())); }
    if (backend) await stopBackend(backend);
  }
});
