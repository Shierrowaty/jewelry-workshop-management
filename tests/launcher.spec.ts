import { spawn } from "node:child_process";
import { GET } from "../src/app/dev-health/route";
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { appState, waitForApp, startApp, openBrowser } from "../scripts/start-app.cjs";
test("launcher rozpoznaje aplikację, obcy proces i wolny port", async () => {
  let own = true;
  const server = createServer((request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(own && request.url === "/dev-health" ? { application: "jewelry-workshop-demo", protocol: 1 } : { application: "other" })); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try { expect(await appState(port)).toBe("app"); own = false; expect(await appState(port)).toBe("other"); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  expect(await appState(port)).toBe("free");
});
test("launcher czeka na HTTP, kończy po gotowości lub błędzie procesu", async () => {
  let calls = 0;
  await waitForApp(async () => ++calls < 3 ? "other" : "app", () => false, 5000);
  expect(calls).toBe(3);
  await expect(waitForApp(async () => "free", () => true)).rejects.toThrow("Serwer zakonczyl prace");
  await expect(waitForApp(async () => "other", () => false, 1)).rejects.toThrow("nie osiagnal gotowosci");
});

test("dev-health zwraca publiczny kontrakt launchera i wyłącza cache", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ application: "jewelry-workshop-demo", protocol: 1 });
});
test("działająca aplikacja otwiera przeglądarkę bez drugiego serwera, komunikat poprzedza probe", async () => {
  const messages: string[] = []; let started = 0, opened = 0;
  let ready!: (state: "free" | "app" | "other") => void;
  const probe = new Promise<"free" | "app" | "other">(resolve => { ready = resolve; });
  const running = startApp({}, { state: () => probe, start: () => { started++; return () => false; }, open: async () => { opened++; }, write: (message: string) => { messages.push(message); } });
  expect(messages[0]).toContain("Sprawdzam serwer http://127.0.0.1:3000");
  ready("app"); await running;
  expect(started).toBe(0); expect(opened).toBe(1);
  expect(messages).toContain("Aplikacja gotowa."); expect(messages).toContain("Otwieram przegladarke...");
  expect(messages.at(-1)).toBe("Aplikacja: http://127.0.0.1:3000");
});
test("obcy serwer nie uruchamia Next ani przeglądarki", async () => {
  let started = 0, opened = 0;
  await expect(startApp({}, { state: async () => "other", start: () => { started++; return () => false; }, open: async () => { opened++; }, write: () => {} })).rejects.toThrow("Nie uruchomiono drugiego serwera ani innego portu");
  expect(started).toBe(0); expect(opened).toBe(0);
});
test("nowy serwer: oczekiwanie, komunikaty postępu i przeglądarka dopiero po gotowości", async () => {
  const messages: string[] = []; let started = 0, opened = 0;
  await startApp({}, { state: async () => "free", start: () => { started++; return () => false; }, open: async () => { opened++; }, write: (message: string) => { messages.push(message); }, wait: async (_state, _failed, _timeout, progress) => { expect(opened).toBe(0); expect(messages.some(message => message.startsWith("Czekam na serwer"))).toBe(true); progress?.(); } });
  expect(started).toBe(1); expect(opened).toBe(1);
  expect(messages.some(message => message.includes("Nadal czekam na serwer... Log:"))).toBe(true);
});
test("nieudany start nie otwiera przeglądarki ani nie deklaruje gotowości", async () => {
  const messages: string[] = []; let opened = 0;
  await expect(startApp({}, { state: async () => "free", start: () => () => true, open: async () => { opened++; }, write: (message: string) => { messages.push(message); } })).rejects.toThrow("Serwer zakonczyl prace");
  expect(opened).toBe(0); expect(messages).not.toContain("Aplikacja gotowa.");
});

test("Windows CMD otrzymuje poprawne cudzysłowy adresu zamiast backslashy MSVCRT", async () => {
  test.skip(process.platform !== "win32", "Parser CMD jest dostępny na Windows");
  let output = "";
  let closed = Promise.resolve();
  await openBrowser((file, args, options) => {
    // Exercise the real production argument/options builder, but echo instead of opening a user's browser.
    expect(args[3]).toBe('start "" "http://127.0.0.1:3000"');
    const child = spawn(file, [...args.slice(0, 3), args[3].replace(/^start /, "echo ")], { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", data => { output += data.toString(); });
    closed = new Promise<void>(resolve => child.once("close", () => resolve()));
    return child;
  });
  await closed;
  expect(output.trim()).toBe('"" "http://127.0.0.1:3000"');
});
