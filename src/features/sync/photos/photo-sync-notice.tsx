"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDatabase } from "../../quotes/data/database";

export function PhotoSyncNotice({ quoteId }: { quoteId: string }) {
  const result = useLiveQuery(async () => {
    try { return { states: await getLocalDatabase().photoSync.where("quoteId").equals(quoteId).toArray(), error: false }; }
    catch { return { states: [], error: true }; }
  }, [quoteId]);
  if (result?.error) return <p className="text-xs text-amber-900">Nie można odczytać stanu synchronizacji zdjęć. Galeria lokalna pozostaje dostępna.</p>;
  const problems = result?.states.filter(state => state.error || state.phase === "conflict") ?? [];
  const downloading = result?.states.filter(state => state.phase === "download").length ?? 0;
  return <>
    {downloading > 0 && <p className="text-xs text-muted">Zdjęcia oczekujące na pobranie: {downloading}.</p>}
    {problems.length > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>Nie wszystkie zdjęcia są zsynchronizowane. Ponów przyciskiem „Synchronizuj”.</p><ul>{problems.map(state => <li key={state.photoId}>{state.error || "Konflikt zdjęcia wymaga wyjaśnienia."}</li>)}</ul></div>}
  </>;
}
