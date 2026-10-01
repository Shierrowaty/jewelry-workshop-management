import { chromium, expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { CloudQuote, CloudQuoteWrite, CloudPhoto, CloudPhotoWrite } from "../src/lib/supabase/database.types";
import type { SavedQuote } from "../src/features/quotes/data/types";
import { readPhotos, expectPhotoCount } from "./photo-scenario";

const origin = "http://127.0.0.1:3101";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "40000000-0000-4000-8000-000000000001";

async function startServer() {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3101"], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Sync test server timeout")); }, 30_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Test server exited: ${code}`)); });
    const read = (chunk: Buffer) => { output += chunk.toString(); if (output.includes("Ready in")) { clearTimeout(timer); resolve(); } };
    child.stdout?.on("data", read); child.stderr?.on("data", read);
  });
  return child;
}
async function readQuotes(page: Page): Promise<SavedQuote[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("jewelry-workshop-demo");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("quotes", "readonly"), result = tx.objectStore("quotes").getAll();
      tx.oncomplete = () => { db.close(); resolve(result.result); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

test("B1/B2: dwie bazy, sesja, konflikt wycen, zdjęcia i usunięcie offline", async ({}, testInfo) => {
  const rows = new Map<string, CloudQuote>();
  const photoRows = new Map<string, CloudPhoto>();
  const objects = new Map<string, Blob>();
  const unexpected: string[] = [], errors: string[] = [];
  const authUser = { id: userId, email: "Demo@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  // Synthetic token accepted ONLY by the intercepted transport. Never sent to real Supabase.
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: userId, exp: expires, role: "authenticated" })).toString("base64url"), Buffer.from("isolated-test-signature").toString("base64url")].join(".");
  const session = { access_token: token, refresh_token: "isolated-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: expires, user: authUser };
  let failPhotoUpload = false;
  let tick = 0, uploads = 0, server: ChildProcess | undefined, a: BrowserContext | undefined, b: BrowserContext | undefined;
  const stamp = () => new Date(Date.UTC(2026,8,4,12,0,++tick)).toISOString();
  async function intercept(route: Route) {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*" } });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" } });
    if (url.pathname === "/auth/v1/token") {
      const body = request.postDataJSON();
      return body.password === "wrong-password" ? reply({ error_code: "invalid_credentials", msg: "Invalid credentials" },400) : reply(session);
    }
    if (url.pathname === "/auth/v1/user") return reply(authUser);
    if (url.pathname === "/auth/v1/logout") return reply({});
    const many = (items: unknown[]) => reply(request.headers().accept?.includes("vnd.pgrst.object") ? items[0] ?? null : items);
    if (url.pathname === "/rest/v1/workspace_members") return many([{ workspace_id: workspaceId }]);
    if (url.pathname === "/rest/v1/workspaces") return many([{ id: workspaceId, name: "Wspólna pracownia testowa" }]);
    if (url.pathname === "/rest/v1/knowledge_categories" || url.pathname === "/rest/v1/knowledge_entries") return many([]);
    if (url.pathname === "/rest/v1/quotes") {
      if (request.method() === "GET") {
        let found = [...rows.values()].filter(row => `eq.${row.workspace_id}` === url.searchParams.get("workspace_id"));
        const id = url.searchParams.get("id"); if (id) found = found.filter(row => `eq.${row.id}` === id);
        found.sort((a,b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id));
        const cursor = url.searchParams.get("or")?.match(/server_updated_at.gt.([^,]+),and\(server_updated_at.eq.[^,]+,id.gt.([^\)]+)/);
        if (cursor) found = found.filter(row => row.server_updated_at > cursor[1] || row.server_updated_at === cursor[1] && row.id > cursor[2]);
        return many(found.slice(0,Number(url.searchParams.get("limit") ?? 100)));
      }
      const input = request.postDataJSON() as CloudQuoteWrite;
      if (input.workspace_id !== workspaceId) return reply({ code: "42501", message: "workspace denied" },403);
      const current = rows.get(input.id);
      if (request.method() === "POST" && current) return reply({ code: "23505", message: "duplicate" },409);
      if (request.method() === "PATCH" && (!current || url.searchParams.get("revision") !== `eq.${current.revision}` || url.searchParams.get("server_updated_at") !== `eq.${current.server_updated_at}`)) return reply(null);
      const saved = { ...input, server_updated_at: stamp() }; rows.set(input.id,saved); uploads++;
      return reply(saved);
    }
    if (url.pathname === "/rest/v1/quote_photos") {
      if (request.method() === "GET") {
        let found = [...photoRows.values()].filter(row => `eq.${row.workspace_id}` === url.searchParams.get("workspace_id"));
        const id = url.searchParams.get("id"); if (id) found = found.filter(row => `eq.${row.id}` === id);
        found.sort((a,b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id));
        return many(found);
      }
      const input = request.postDataJSON() as CloudPhotoWrite;
      if (input.workspace_id !== workspaceId || !rows.has(input.quote_id)) return reply({ code: "42501", message: "parent/workspace denied" },403);
      const current = photoRows.get(input.id);
      if (request.method() === "POST" && current) return reply({ code: "23505" },409);
      if (request.method() === "PATCH" && (!current || url.searchParams.get("revision") !== `eq.${current.revision}` || url.searchParams.get("server_updated_at") !== `eq.${current.server_updated_at}`)) return reply(null);
      const saved = { ...input, server_updated_at: stamp() }; photoRows.set(input.id,saved); return reply(saved);
    }
    const uploadPrefix = "/storage/v1/object/quote-photos/";
    const downloadPrefix = uploadPrefix; // storage-js download uses /object with the session Authorization header.
    if (request.method() === "POST" && url.pathname.startsWith(uploadPrefix)) {
      const path = decodeURIComponent(url.pathname.slice(uploadPrefix.length));
      const metadata = [...photoRows.values()].find(row => row.storage_path === path);
      if (!metadata || metadata.deleted_at) return reply({ message: "metadata required" },403);
      if (failPhotoUpload) return reply({ message: "access_token=synthetic-secret customer=synthetic-private" },500);
      if (objects.has(path)) return reply({ statusCode: "409", error: "Duplicate", message: "already exists" },409);
      const form = await new Response(new Uint8Array(request.postDataBuffer()!), { headers: { "content-type": request.headers()["content-type"] } }).formData();
      const file = [...form.values()].find(value => value instanceof Blob);
      if (!(file instanceof Blob)) throw new Error("Missing multipart file");
      expect(file.size).toBe(metadata.size); expect(file.type).toBe(metadata.mime_type);
      objects.set(path,file); return reply({ Key: `quote-photos/${path}` });
    }
    if (request.method() === "GET" && url.pathname.startsWith(downloadPrefix)) {
      const path = decodeURIComponent(url.pathname.slice(downloadPrefix.length)), file = objects.get(path);
      return file ? route.fulfill({ contentType: file.type, body: Buffer.from(await file.arrayBuffer()), headers: { "access-control-allow-origin": "*" } }) : reply({ message: "Object not found" },404);
    }
    if (request.method() === "DELETE" && url.pathname === "/storage/v1/object/quote-photos") {
      const paths = request.postDataJSON().prefixes as string[];
      for (const path of paths) {
        expect([...photoRows.values()].find(row => row.storage_path === path)?.deleted_at).toBeTruthy();
        objects.delete(path);
      }
      return reply([]);
    }
    // No pass-through fallback: not even test failures can reach production Auth/Storage/data.
    unexpected.push(url.pathname); return route.abort();
  }
  async function launch(profile: string) {
    const context = await chromium.launchPersistentContext(profile, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, viewport: { width: 1366, height: 900 }, locale: "pl-PL" });
    await context.route("**/*", intercept);
    const attach = (page: Page) => page.on("pageerror", error => errors.push(error.message));
    context.pages().forEach(attach); context.on("page", attach);
    return context;
  }
  async function login(page: Page) {
    await page.goto(`${origin}/logowanie`);
    await page.getByLabel("E-mail", { exact: true }).fill(authUser.email);
    await page.getByLabel("Hasło", { exact: true }).fill("isolated-test-password");
    await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
    await expect(page.getByText("Wspólna pracownia testowa", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Połącz i synchronizuj dane", exact: true }).click();
    await expect(page.getByRole("button", { name: "Połącz i synchronizuj dane", exact: true })).not.toBeVisible();
    await page.getByRole("navigation", { name: "Menu główne" }).getByRole("link", { name: "Pulpit", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Zsynchronizowano$/ })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("region", { name: "Panel użytkownika" })).toContainText("Witaj, Demo 👋");
  }
  async function manualSync(page: Page) {
    const previous = page.url();
    await page.goto(`${origin}/`);
    await page.getByRole("button", { name: "Synchronizuj teraz", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Zsynchronizowano$/ })).toBeVisible();
    await page.goto(previous);
  }
  async function saveNotes(page: Page, notes: string) {
    await page.getByLabel("Uwagi", { exact: true }).fill(notes);
    await page.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
    await expect(page.getByText("Zmiany zostały zapisane lokalnie.", { exact: true })).toBeVisible();
  }
  try {
    const root = join(process.cwd(), "test-results"); await mkdir(root, { recursive: true });
    const profileA = await mkdtemp(join(root,"sync-a-")), profileB = await mkdtemp(join(root,"sync-b-"));
    server = await startServer(); a = await launch(profileA); let pageA = a.pages()[0];
    await pageA.goto(`${origin}/`);
    const userPanel = pageA.getByRole("region", { name: "Panel użytkownika" });
    await expect(userPanel).toContainText("Nie jesteś zalogowany");
    await expect(userPanel.getByRole("link", { name: "Zaloguj", exact: true })).toHaveAttribute("href", "/logowanie");
    await expect(pageA.getByText("Nie zakończono jeszcze pełnej synchronizacji.", { exact: false })).toBeVisible();
    await expect(pageA.getByText(/Inny host lub port oznacza/)).toHaveCount(0); // production build
    await pageA.goto(`${origin}/nowa-wycena`);
    await pageA.getByLabel("Imię i nazwisko").fill("Realizacja B1 — dwa urządzenia");
    await pageA.getByLabel("Waga produktu (g)").fill("5,5");
    await pageA.getByLabel("Cena zakupu złota za gram").fill("350");
    await pageA.getByRole("button", { name: "Zapisz wycenę", exact: true }).click();
    await expect(pageA).toHaveURL(/\/realizacje\/[\da-f-]+$/);
    const [original] = await readQuotes(pageA); expect(rows.size).toBe(0);
    const photoBytes = await pageA.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), "image/png"));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await pageA.locator('input[type="file"]').setInputFiles({ name: "local.png", mimeType: "image/png", buffer: Buffer.from(photoBytes) });
    await expectPhotoCount(pageA, 1); let photos = await readPhotos(pageA); photos = photos.map(photo => ({...photo, syncStatus: "synced"}));
    await login(pageA); expect(rows.get(original.id)?.snapshot).toEqual(original.snapshot); expect(uploads).toBe(1);
    b = await launch(profileB); let pageB = b.pages()[0]; await login(pageB);
    await expect.poll(async () => (await readQuotes(pageB)).length).toBe(1);
    expect((await readQuotes(pageB))[0]).toMatchObject({ id: original.id, syncStatus: "synced", snapshot: original.snapshot });
    expect(await pageB.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("sb-") && key.endsWith("-auth-token")).length)).toBe(1);
    await b.close(); b = await launch(profileB); pageB = b.pages()[0];
    await pageB.goto(`${origin}/logowanie`);
    await expect(pageB.getByText(authUser.email, { exact: true })).toBeVisible();
    await expect(pageB.getByRole("region", { name: "Panel użytkownika" })).toContainText("Zalogowano");
    await pageB.reload();
    await expect(pageB.getByRole("region", { name: "Panel użytkownika" })).toContainText("Witaj, Demo 👋");
    await manualSync(pageB);
    await pageA.goto(`${origin}/realizacje/${original.id}`); await expectPhotoCount(pageA,1);
    await a.setOffline(true); await expect.poll(() => pageA.evaluate(() => navigator.onLine)).toBe(false);
    await expect(pageA.getByRole("heading", { name: "Synchronizacja", exact: true })).toHaveCount(0);
    await saveNotes(pageA, "Zmiana bez internetu");
    expect((await readQuotes(pageA))[0].syncStatus).toBe("pending"); expect(rows.get(original.id)?.notes).toBe("");
    await a.setOffline(false); await expect.poll(() => rows.get(original.id)?.notes).toBe("Zmiana bez internetu");
    await manualSync(pageB);
    await expect.poll(async () => (await readQuotes(pageB))[0].notes).toBe("Zmiana bez internetu");
    await pageB.goto(`${origin}/realizacje/${original.id}`); await expectPhotoCount(pageB,1);
    expect((await readPhotos(pageB))[0].hash).toBe(photos[0].hash);
    await a.setOffline(true); await saveNotes(pageA,"Wersja lokalna A"); await saveNotes(pageB,"Wersja chmurowa B");
    await expect.poll(() => rows.get(original.id)?.notes).toBe("Wersja chmurowa B");
    await a.setOffline(false);
    const conflict = pageA.getByRole("region", { name: "Konflikt synchronizacji", exact: true });
    await expect(conflict).toBeVisible(); await expect(conflict).toContainText("Wersja lokalna A"); await expect(conflict).toContainText("Wersja chmurowa B");
    await conflict.scrollIntoViewIfNeeded();
    await pageA.screenshot({ path: testInfo.outputPath("konflikt-b1.png") });
    pageA.once("dialog", dialog => dialog.accept()); await conflict.getByRole("button", { name: "Pobierz wersję z chmury", exact: true }).click();
    await expect(conflict).not.toBeVisible(); expect((await readQuotes(pageA))[0].notes).toBe("Wersja chmurowa B");
    expect(await readPhotos(pageA)).toEqual(photos);
    // B2 keeps offline gallery writes local, then transfers both add and tombstone.
    await a.setOffline(true);
    const lastSuccess = await pageA.evaluate(() => new Promise<string>(resolve => {
      const request = indexedDB.open("jewelry-workshop-demo");
      request.onsuccess = () => { const db = request.result; const read = db.transaction("syncSettings").objectStore("syncSettings").get("workspace"); read.onsuccess = () => { resolve(read.result.lastSuccessfulSyncAt); db.close(); }; };
    }));
    await pageA.locator('input[type="file"]').setInputFiles({ name: "kolejne.png", mimeType: "image/png", buffer: Buffer.from(photoBytes) });
    await expectPhotoCount(pageA,2);
    pageA.once("dialog", dialog => dialog.accept());
    await pageA.getByRole("button", { name: "Usuń zdjęcie: local.png", exact: true }).click();
    await expectPhotoCount(pageA,1); expect(objects.size).toBe(1);
    failPhotoUpload = true;
    await a.setOffline(false);
    await pageA.goto(`${origin}/`);
    await expect(pageA.getByRole("status").filter({ hasText: /^Błąd$/ })).toBeVisible();
    const afterFailure = await pageA.evaluate(() => new Promise<{ date: string; logs: unknown[] }>(resolve => {
      const request = indexedDB.open("jewelry-workshop-demo");
      request.onsuccess = () => { const db = request.result; const tx = db.transaction(["syncSettings", "appLogs"]); const binding = tx.objectStore("syncSettings").get("workspace"), logs = tx.objectStore("appLogs").getAll(); tx.oncomplete = () => { resolve({ date: binding.result.lastSuccessfulSyncAt, logs: logs.result }); db.close(); }; };
    }));
    expect(afterFailure.date).toBe(lastSuccess);
    expect(JSON.stringify(afterFailure.logs)).not.toContain("synthetic-secret");
    expect(JSON.stringify(afterFailure.logs)).not.toContain("synthetic-private");
    expect(afterFailure.logs).toEqual(expect.arrayContaining([expect.objectContaining({ category: "photo" })]));
    failPhotoUpload = false;
    await manualSync(pageA);
    await pageA.goto(`${origin}/realizacje/${original.id}`);
    await expect.poll(() => [...photoRows.values()].filter(row => !!row.deleted_at).length).toBe(1);
    await manualSync(pageA);
    expect(photoRows.size).toBe(2); expect(objects.size).toBe(1);
    await manualSync(pageB);
    await expect.poll(async () => (await readPhotos(pageB)).filter(photo => photo.deletedAt === null).map(photo => photo.originalFileName)).toEqual(["kolejne.png"]);
    await expectPhotoCount(pageB,1);
    photos = await readPhotos(pageA);
    await pageB.goto(`${origin}/`);
    await b.grantPermissions(["clipboard-read", "clipboard-write"]);
    await pageB.getByRole("button", { name: "Pokaż logi", exact: true }).click();
    await expect(pageB.locator("#app-logs")).toBeVisible();
    await pageB.getByRole("button", { name: "Kopiuj raport diagnostyczny", exact: true }).click();
    await expect(pageB.getByText("Raport diagnostyczny skopiowano.", { exact: true })).toBeVisible();
    const report = await pageB.evaluate(() => navigator.clipboard.readText());
    expect(report).not.toContain(token); expect(report).not.toContain(session.refresh_token); expect(report).not.toContain(authUser.email); expect(report).not.toContain(original.snapshot.customer.name);
    expect(JSON.parse(report).lastSuccessfulSyncAt).toBeTruthy();
    await pageB.screenshot({ path: testInfo.outputPath("pulpit-diagnostyka.png"), fullPage: true });
    await pageB.getByRole("region", { name: "Panel użytkownika" }).getByRole("button", { name: "Wyloguj", exact: true }).click();
    await expect(pageB.getByRole("region", { name: "Panel użytkownika" })).toContainText("Nie jesteś zalogowany");
    await pageB.goto(`${origin}/logowanie`);
    await expect(pageB.getByRole("button", { name: "Zaloguj się", exact: true })).toBeVisible();
    expect(await readQuotes(pageB)).toHaveLength(1);
    await a.close(); a = await launch(profileA); pageA = a.pages()[0]; await pageA.goto(`${origin}/realizacje/${original.id}`);
    await expectPhotoCount(pageA,1); expect(await readPhotos(pageA)).toEqual(photos);
    expect((await readQuotes(pageA))[0]).toMatchObject({ id: original.id, notes: "Wersja chmurowa B", syncStatus: "synced" });
    expect(rows.size).toBe(1); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await a?.close(); await b?.close();
    if (server && server.exitCode === null && server.signalCode === null) { const stopped = once(server,"exit"); server.kill(); await stopped; }
  }
});
