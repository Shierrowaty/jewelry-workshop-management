"use client";
import { liveQuery } from "dexie";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getLocalDatabase } from "../quotes/data/database";
import { useQuoteSync } from "../sync/sync-provider";
import { logsFor, type AppLog } from "./logs";
import { diagnosticReport, originWarning } from "./report";
export const diagnosticButton = "min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-gold-soft disabled:opacity-50";
const subscribeOrigin = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";
export function DiagnosticsPanel() {
  const { view } = useQuoteSync();
  const [logs, setLogs] = useState<AppLog[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const origin = useSyncExternalStore(subscribeOrigin, clientOrigin, serverOrigin);
  const warning = origin ? originWarning(origin, process.env.NODE_ENV === "development") : null;
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const repo = logsFor(getLocalDatabase());
    const subscription = liveQuery(() => repo.recent()).subscribe({ next: values => { setLogs(values); setUnavailable(repo.unavailable()); }, error: () => setUnavailable(true) });
    const unsubscribe = repo.subscribe(() => { setUnavailable(repo.unavailable()); void repo.recent().then(setLogs); });
    return () => { subscription.unsubscribe(); unsubscribe(); };
  }, []);
  const recent = (logs ?? []).filter(log => log.level !== "info" && Date.parse(log.createdAt) >= now - 7 * 86400000);
  async function copy() {
    try {
      const repo = logsFor(getLocalDatabase());
      const current = await repo.recent();
      await navigator.clipboard.writeText(diagnosticReport(view, current, window.location.origin, repo.unavailable()));
      setNotice("Raport diagnostyczny skopiowano.");
    } catch { setNotice("Nie można skopiować raportu. Zezwól przeglądarce na dostęp do schowka i spróbuj ponownie."); }
  }
  return <section aria-labelledby="diagnostics-title" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
    <h2 id="diagnostics-title" className="font-display text-3xl text-ink">Stan aplikacji</h2>
    <p className="mt-2 text-xs text-muted">Problemy z ostatnich 7 dni · dziennik lokalny, maksymalnie 500 wpisów</p>
    <div className="my-5 rounded-xl bg-gold-soft p-4 text-sm leading-6">
      {unavailable ? <p role="alert">Dziennik lokalny jest niedostępny. Część diagnostyki pozostaje tylko w pamięci tej karty.</p> : logs === null ? <p>Odczytywanie dziennika…</p> : recent.length ? <><p className="font-semibold">Wykryte problemy: {recent.length}</p><p>{recent[0].message}</p><p className="text-xs text-muted">{new Date(recent[0].createdAt).toLocaleString("pl-PL")}</p></> : <p>Brak wykrytych problemów</p>}
    </div>
    {warning && <p role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{warning}</p>}
    <div className="flex flex-wrap gap-3"><button className={diagnosticButton} aria-expanded={expanded} aria-controls="app-logs" onClick={() => setExpanded(!expanded)}>{expanded ? "Ukryj logi" : "Pokaż logi"}</button><button className={diagnosticButton} onClick={() => void copy()}>Kopiuj raport diagnostyczny</button></div>
    {notice && <p role="status" className="mt-3 text-sm text-muted">{notice}</p>}
    {expanded && <div id="app-logs" className="mt-5 max-h-96 overflow-auto rounded-xl border border-line p-4">{!logs?.length ? <p className="text-sm text-muted">Brak zapisanych logów.</p> : <ol className="space-y-4">{logs.map(log => <li key={log.id} className="border-b border-line pb-3 text-sm"><p className="text-xs text-muted">{new Date(log.createdAt).toLocaleString("pl-PL")} · {log.level} · {log.category}{log.code ? ` · ${log.code}` : ""}</p><p className="mt-1">{log.message}</p></li>)}</ol>}</div>}
  </section>;
}
