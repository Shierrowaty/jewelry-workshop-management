import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import manifest from "../src/app/manifest";

function worker(options: { offline?: boolean; windows?: { id: string }[]; failInstall?: boolean } = {}) {
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const network: string[] = [], added: Request[][] = [], deleted: string[] = [], messages: unknown[] = [];
  let skipped = 0;
  const cache = {
    addAll: async (requests: Request[]) => { added.push(requests); if (options.failInstall) throw new Error("quota"); },
    match: async (url: string) => url === "/offline" ? new Response("<html>UI only</html>", { headers: { "content-type": "text/html", "content-encoding": "gzip", "content-length": "123" } }) : new Response("asset"),
  };
  runInNewContext(readFileSync("src/features/pwa/worker.js", "utf8"), {
    VERSION: "v3", ASSETS: ["/offline", "/_next/static/ui.js", "/pwa/icon-192.png"], URL, Request: class extends Request { constructor(url: string, init: RequestInit) { super(new URL(url, "https://app.example"), init); } }, Response, Headers, AbortSignal, Set,
    self: {
      location: { origin: "https://app.example" },
      addEventListener: (name: string, listener: typeof listeners[string]) => { listeners[name] = listener; },
      skipWaiting: async () => { skipped++; },
      clients: { matchAll: async () => options.windows ?? [{ id: "current" }], claim: async () => {} },
    },
    caches: { open: async () => cache, keys: async () => ["unrelated-cache", "jwm-ui-v1", "jwm-ui-v2", "jwm-ui-v3"], delete: async (key: string) => { deleted.push(key); } },
    fetch: async (request: Request) => { network.push(request.url); if (options.offline) throw new Error("offline"); return new Response("network response"); },
  });
  return {
    network, added, deleted, messages, skipped: () => skipped,
    async event(name: string, extra: Record<string, unknown> = {}) {
      let result: Promise<unknown> | undefined;
      listeners[name]({ source: { id: "current", postMessage: (data: unknown) => messages.push(data) }, waitUntil: (promise: Promise<unknown>) => { result = promise; }, ...extra });
      return result;
    },
    async fetch(url: string, options: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
      let result: Promise<Response> | undefined;
      listeners.fetch({ request: { url, method: "GET", mode: "cors", ...options, headers: new Headers(options.headers) }, respondWith: (promise: Promise<Response>) => { result = promise; } });
      return result;
    },
  };
}

test("manifest i ikony mają poprawne parametry instalacji", () => {
  const value = manifest();
  expect(value).toMatchObject({ name: "Pracownia Demo", id: "/", scope: "/", start_url: "/", display: "standalone", theme_color: "#242823" });
  for (const size of [192, 512, 180]) {
    const file = readFileSync(`public/pwa/${size === 180 ? "apple-touch-icon" : `icon-${size}`}.png`);
    expect(file.subarray(1, 4).toString()).toBe("PNG");
    expect(file.readUInt32BE(16)).toBe(size);
    expect(file.readUInt32BE(20)).toBe(size);
  }
});
test("instalacja pobiera wyłącznie jawnie wskazany interfejs, bez cookies i bez autoaktualizacji", async () => {
  const sw = worker(); await sw.event("install");
  expect(sw.added[0].map(request => new URL(request.url).pathname)).toEqual(["/offline", "/_next/static/ui.js", "/pwa/icon-192.png"]);
  expect(sw.added[0].every(request => request.credentials === "omit")).toBe(true);
  expect(sw.skipped()).toBe(0);
});
test("nieudana instalacja nie aktywuje częściowej wersji", async () => {
  const sw = worker({ failInstall: true });
  await expect(sw.event("install")).rejects.toThrow("quota");
  expect(sw.skipped()).toBe(0);
});
test("Supabase, API, tokeny, zapisy oraz obce zasoby omijają worker", async () => {
  const sw = worker();
  for (const path of ["auth/v1/token", "rest/v1/quotes", "storage/v1/object/photos/1"]) {
    expect(await sw.fetch(`https://cloud.supabase.co/${path}`)).toBeUndefined();
    expect(await sw.fetch(`https://app.example/${path}`)).toBeUndefined();
  }
  expect(await sw.fetch("https://app.example/api/sync")).toBeUndefined();
  expect(await sw.fetch("https://app.example/dev-health")).toBeUndefined();
  expect(await sw.fetch("https://app.example/realizacje", { method: "POST" })).toBeUndefined();
  expect(await sw.fetch("https://app.example/_next/static/ui.js", { headers: { authorization: "Bearer synthetic-secret" } })).toBeUndefined();
  expect(sw.added).toEqual([]);
  expect(sw.network).toEqual([]);
});
test("offline shell obsługuje nowy adres realizacji i RSC, nie zapisuje odpowiedzi", async () => {
  const sw = worker({ offline: true });
  for (const options of [{ mode: "navigate" }, { headers: { rsc: "1" } }]) {
    const response = await sw.fetch("https://app.example/realizacje/new-id/edytuj", options);
    expect(await response?.text()).toContain("UI only");
    expect(response?.url).toBe("");
    expect(response?.headers.get("content-type")).toBe("text/html");
    expect(response?.headers.has("content-encoding")).toBe(false);
    expect(response?.headers.has("content-length")).toBe(false);
  }
  expect(sw.added).toEqual([]);
});
test("nawigacje online pozostają sieciowe, statyczne pliki są dostępne z cache", async () => {
  const sw = worker();
  expect(await (await sw.fetch("https://app.example/realizacje", { mode: "navigate" }))?.text()).toBe("network response");
  expect(await (await sw.fetch("https://app.example/_next/static/ui.js"))?.text()).toBe("asset");
  expect(sw.added).toEqual([]);
});
test("aktualizacja wymaga zgody i zamknięcia pozostałych kart", async () => {
  const sw = worker({ windows: [{ id: "current" }, { id: "editing" }] });
  await sw.event("message", { data: { type: "ACTIVATE_UPDATE" } });
  expect(sw.skipped()).toBe(0);
  expect(sw.messages).toEqual([{ type: "UPDATE_BLOCKED" }]);
  const single = worker();
  await single.event("message", { data: { type: "unrelated" } });
  expect(single.skipped()).toBe(0);
  await single.event("message", { data: { type: "ACTIVATE_UPDATE" } });
  expect(single.skipped()).toBe(1);
  await single.event("activate");
  expect(single.deleted).toEqual(["jwm-ui-v1"]);
});

test("Kalkulator i szkice wyceny mają powłokę offline bez zapisywania danych w cache", async () => {
  const sw=worker({offline:true});
  for(const path of ["/kalkulator","/kalkulator/zapisane","/kalkulator/test-id","/nowa-wycena/z-kalkulatora/test-id"]) {
    const response=await sw.fetch(`https://app.example${path}`,{mode:"navigate"});expect(await response?.text()).toContain("UI only");
  }
  expect(sw.added).toEqual([]);
});
