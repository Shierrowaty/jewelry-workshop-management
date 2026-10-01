const { createConnection } = require("node:net");
const { spawn } = require("node:child_process");
const { appendFileSync, openSync, closeSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const projectRoot = resolve(__dirname, "..");
const address = "http://127.0.0.1:3000";
const logPath = join(tmpdir(), "jewelry-workshop-demo-dev.log");
async function appState(port = 3000) {
  const listening = await new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true)); socket.once("error", error => finish(error.code !== "ECONNREFUSED"));
    socket.setTimeout(2000, () => finish(true));
  });
  if (!listening) return "free";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/dev-health`, { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
    const data = await response.json();
    if (response.ok && data.application === "jewelry-workshop-demo" && data.protocol === 1) return "app";
  } catch { /* Occupied but unidentified: never start a second server. */ }
  return "other";
}
async function waitForApp(state, processFailed, timeoutMs = 180000, progress = () => {}) {
  const deadline = Date.now() + timeoutMs;
  let nextNotice = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (processFailed()) throw new Error("Serwer zakonczyl prace przed osiagnieciem gotowosci. Sprawdz log serwera.");
    if (await state() === "app") return;
    if (Date.now() >= nextNotice) { progress(); nextNotice = Date.now() + 10000; }
    await delay(500);
  }
  throw new Error("Serwer nie osiagnal gotowosci. Sprawdz log; nie uruchamiaj drugiego serwera.");
}
function launchServer() {
    if (!existsSync(join(projectRoot, "node_modules/next"))) throw new Error("Brak zaleznosci. Uruchom npm.cmd ci w katalogu projektu.");
    const log = openSync(logPath, "a");
    let failed = false;
    // Constant shell command; no user input or paths interpolated into shell code.
    let child;
    try { child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd run dev -- --hostname 127.0.0.1 --port 3000"], { cwd: projectRoot, windowsHide: true, detached: true, stdio: ["ignore", log, log] }); }
    finally { closeSync(log); }
    child.once("error", () => { failed = true; }); child.once("exit", () => { failed = true; });
    child.unref();
    return () => failed;
}
// CMD uses its own quoting rules; MSVCRT escaping would turn quotes into literal backslashes.
/** @param {(file: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} [spawnProcess] */
function openBrowser(spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
      const browser = spawnProcess(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", 'start "" "http://127.0.0.1:3000"'], { windowsHide: true, windowsVerbatimArguments: true, stdio: "ignore" });
      const timer = setTimeout(() => { browser.kill(); reject(new Error("Przegladarka nie potwierdzila uruchomienia. Otworz recznie " + address)); }, 15000);
      browser.once("error", error => { clearTimeout(timer); reject(error); });
      browser.once("exit", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("Nie mozna otworzyc przegladarki. Otworz recznie " + address)); });
  });
}
async function startApp({ noBrowser = false } = {}, { state = appState, start = launchServer, open = openBrowser, write = console.log, wait = waitForApp } = {}) {
  write("Sprawdzam serwer " + address + "...");
  const current = await state();
  if (current === "other") throw new Error("Port 3000 jest zajety przez inny lub nierozpoznany serwer (/dev-health nie potwierdzil aplikacji). Zatrzymaj go recznie. Nie uruchomiono drugiego serwera ani innego portu.");
  if (current === "free") {
    write("Uruchamianie serwera Next.js...");
    const failed = start();
    write("Czekam na serwer... Pierwsze uruchomienie moze potrwac do 3 minut.");
    await wait(state, failed, 180000, () => write("Nadal czekam na serwer... Log: " + logPath));
  } else { write("Aplikacja juz dziala. Korzystam z istniejacego serwera."); }
  write("Aplikacja gotowa.");
  if (!noBrowser) { write("Otwieram przegladarke..."); await open(); }
  write("Aplikacja: " + address);
}
async function main() {
  console.log("Uruchamianie aplikacji...");
  console.log("Log: " + logPath);
  try {
    if (process.platform !== "win32") throw new Error("Ten launcher jest przeznaczony dla Windows.");
    appendFileSync(logPath, `\nUruchomienie launchera: ${new Date().toISOString()}\n`);
    await startApp({ noBrowser: process.argv.includes("--no-browser") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany blad launchera.";
    console.error("BLAD: " + message);
    console.error("Log: " + logPath);
    console.error("Staly adres aplikacji: " + address);
    try { appendFileSync(logPath, `BLAD: ${message}\n`); } catch { console.error("Nie mozna zapisac logu. Sprawdz uprawnienia do katalogu TEMP."); }
    process.exitCode = 1;
  }
}
module.exports = { appState, waitForApp, startApp, openBrowser };
if (require.main === module) void main();
