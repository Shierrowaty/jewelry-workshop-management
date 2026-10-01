"use client";
import Link from "next/link";
import { Cloud, RefreshCw } from "lucide-react";
import { useQuoteSync } from "./sync-provider";
import { syncLabel } from "./sync-controller";
import { diagnosticButton } from "../diagnostics/diagnostics-panel";
export function SyncStatus() {
  const { controller, view } = useQuoteSync();
  const last = view.summary?.binding?.lastSuccessfulSyncAt;
  return <section aria-labelledby="sync-title" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
    <div className="flex items-center gap-3"><Cloud size={24} className="text-gold" aria-hidden="true"/><h2 id="sync-title" className="font-display text-3xl text-ink">Synchronizacja</h2></div>
    <p role="status" className="mt-5 inline-flex rounded-lg bg-gold-soft px-3 py-2 text-sm font-semibold text-ink">{!view.ready ? "Odtwarzanie sesji…" : syncLabel(view)}</p>
    <p className="mt-4 text-sm leading-6 text-muted">Ostatnia udana synchronizacja: {last ? new Date(last).toLocaleString("pl-PL") : "Nie zakończono jeszcze pełnej synchronizacji."}</p>
    <dl className="my-5 grid grid-cols-2 gap-4"><div className="rounded-xl border border-line p-4"><dt className="text-xs text-muted">Oczekujące wyceny</dt><dd className="mt-1 text-2xl font-semibold">{view.summary?.pending ?? "—"}</dd></div><div className="rounded-xl border border-line p-4"><dt className="text-xs text-muted">Oczekujące zdjęcia</dt><dd className="mt-1 text-2xl font-semibold">{view.summary?.photoPending ?? "—"}</dd></div><div className="rounded-xl border border-line p-4"><dt className="text-xs text-muted">Oczekujące zmiany Bazy wiedzy</dt><dd className="mt-1 text-2xl font-semibold">{view.summary?.knowledgePending ?? "—"}</dd></div></dl>
    {view.message && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{view.message}</p>}
    <button className={`${diagnosticButton} inline-flex items-center gap-2`} disabled={view.busy || !view.online || !view.user || !view.summary?.binding || view.summary.binding.syncPaused} onClick={() => void controller.synchronize()}><RefreshCw size={16} aria-hidden="true"/>Synchronizuj teraz</button>
    {(!view.user || !view.summary?.binding) && <p className="mt-3 text-sm text-muted"><Link href="/logowanie" className="text-gold underline">Zaloguj się i połącz pracownię</Link>, aby synchronizować. Lokalne dane są dostępne bez logowania.</p>}
    {!!view.summary?.knowledgeConflicts && <p className="mt-4 text-sm"><Link className="text-gold underline" href="/cenniki-i-ustawienia">Baza wiedzy: konflikty wymagające decyzji ({view.summary.knowledgeConflicts})</Link></p>}
    {!!view.summary?.conflicts.length && <div className="mt-4 space-y-2"><p className="text-sm font-semibold">Konflikty wycen: {view.summary.conflicts.length}</p>{view.summary.conflicts.map(q => <Link className="block text-sm text-gold underline" key={q.id} href={`/realizacje/${q.id}`}>Otwórz realizację wymagającą decyzji</Link>)}</div>}
    {!!view.summary?.photoConflicts.length && <div className="mt-4 space-y-2"><p className="text-sm font-semibold">Konflikty zdjęć: {view.summary.photoConflicts.length}</p>{view.summary.photoConflicts.map(p => <Link className="block text-sm text-gold underline" key={p.id} href={`/realizacje/${p.quoteId}`}>Otwórz realizację ze zdjęciem w konflikcie</Link>)}</div>}
  </section>;
}
