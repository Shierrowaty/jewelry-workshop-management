"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { SavedQuote } from "../quotes/data/types";
import { getLocalDatabase } from "../quotes/data/database";
import { LocalSyncRepository } from "./local-sync-repository";
import { useQuoteSync } from "./sync-provider";
import { quoteFromCloud } from "./quote-validation";
import { formatMoney } from "../quotes/calculations";

export function QuoteSyncNotice({ quote }: { quote: SavedQuote }) {
  const { controller } = useQuoteSync();
  const result = useLiveQuery(async () => {
    try { return { state: await new LocalSyncRepository(getLocalDatabase()).conflict(quote.id), error: false }; }
    catch { return { state: undefined, error: true }; }
  }, [quote.id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cloud = result?.state?.conflict;
  if (quote.syncStatus !== "conflict") return <p className="mb-5 text-xs text-muted">Synchronizacja wyceny: {quote.syncStatus === "synced" ? "zsynchronizowano" : "oczekuje na wysłanie"}.</p>;
  const remote = cloud ? quoteFromCloud(cloud, cloud.workspace_id) : null;
  async function resolve(choice: "local" | "cloud") {
    if (!cloud || !window.confirm(choice === "local" ? "Zachować lokalną wersję? Przy synchronizacji zastąpi ona pokazaną wersję chmurową, jeśli ta nie zmieniła się ponownie." : "Pobrać wersję z chmury i zastąpić nią lokalną wycenę? Zdjęcia na tym urządzeniu pozostaną bez zmian.")) return;
    setBusy(true); setError(null);
    try { await controller.resolve(quote.id, quote.revision, cloud, choice); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Nie udało się rozstrzygnąć konfliktu."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Konflikt synchronizacji" className="mb-6 space-y-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
    <h2 className="font-semibold">Ta realizacja została zmieniona na innym urządzeniu.</h2>
    <p className="leading-6">Zachowaliśmy obie wersje. Wybierz, która ma obowiązywać. Nie łączymy automatycznie pól ani cen.</p>
    {remote && <div className="grid gap-3 sm:grid-cols-2">{[["Na tym urządzeniu", quote], ["W chmurze", remote]].map(([label, value]) => {
      const data = value as SavedQuote;
      return <div key={String(label)} className="min-w-0 rounded-xl border border-amber-200 bg-white/70 p-4"><p className="font-semibold">{String(label)}</p><p className="mt-2 break-words">{data.snapshot.customer.name || "Bez nazwy klienta"}</p><p>{data.status} · {formatMoney(data.snapshot.totals.gross)}</p><p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs">{data.notes || "Brak uwag"}</p></div>;
    })}</div>}
    {cloud?.deleted_at ? <p>W chmurze zapisano znacznik usunięcia. Synchronizacja nie obsługuje usuwania wycen; zachowano lokalną realizację i zdjęcia. Wymagana jest obsługa administratora.</p> : <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy || !cloud} onClick={() => void resolve("local")} className="min-h-11 rounded-xl bg-sidebar px-4 py-3 font-semibold text-sidebar-text disabled:opacity-50">Zachowaj wersję lokalną</button>
      <button type="button" disabled={busy || !cloud} onClick={() => void resolve("cloud")} className="min-h-11 rounded-xl border border-amber-400 bg-white px-4 py-3 font-semibold disabled:opacity-50">Pobierz wersję z chmury</button>
    </div>}
    {(error || result?.error) && <p role="alert">{error ?? "Nie udało się odczytać szczegółów konfliktu. Odśwież stronę."}</p>}
  </section>;
}
