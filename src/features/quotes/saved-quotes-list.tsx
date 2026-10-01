"use client";

import Link from "next/link";
import { getQuoteDate } from "./defaults";
import { HistoricalQuoteBadge } from "./components/historical-quote-badge";
import { useState } from "react";
import { ArrowUpRight, FolderOpen, Plus } from "lucide-react";
import { formatMoney } from "./calculations";
import { useLocalQuotes } from "./data/use-local-quotes";
import { displayDate, displayTimestamp, quoteProductName } from "./data/presentation";
import { LocalDataError, LocalStorageNotice } from "./components/local-data-state";

export function SavedQuotesList() {
  const { result, retry } = useLocalQuotes();
  const [view, setView] = useState<"active" | "completed">("active");
  const quotes = result?.data?.filter((quote) => view === "active" ? quote.completedAt === null : quote.completedAt !== null);
  return (
    <section aria-labelledby="page-title">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true" />
          <h1 id="page-title" className="font-display text-4xl leading-tight font-medium tracking-tight text-ink sm:text-5xl">Realizacje</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Lokalnie zapisane wyceny, od najnowszej. Otwórz wycenę, aby zobaczyć szczegóły lub zaktualizować zamówienie.</p>
        </div>
        <Link href="/nowa-wycena" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sidebar px-4 py-3 text-sm font-semibold text-sidebar-text hover:bg-sidebar-active"><Plus size={17} aria-hidden="true" />Nowa wycena</Link>
      </div>
      <div role="group" aria-label="Widok realizacji" className="mb-6 inline-flex gap-1 rounded-xl border border-line bg-surface p-1">
        {([{ value: "active", label: "Aktywne" }, { value: "completed", label: "Zakończone" }] as const).map((item) => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => setView(item.value)} className={`min-h-11 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${view === item.value ? "bg-sidebar text-sidebar-text" : "text-muted hover:bg-gold-soft hover:text-ink"}`}>{item.label}</button>)}
      </div>
      {!result && <p role="status" className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Wczytywanie lokalnych wycen…</p>}
      {result?.error && <LocalDataError message={result.error} onRetry={retry} />}
      {quotes?.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center">
          <FolderOpen size={30} strokeWidth={1.4} className="mx-auto mb-4 text-gold" aria-hidden="true" />
          <h2 className="font-display text-3xl font-medium text-ink">{view === "completed" ? "Brak zakończonych realizacji" : result?.data?.length === 0 ? "Jeszcze bez zapisanych wycen" : "Brak aktywnych realizacji"}</h2>
          <p className="mt-3 text-sm leading-6 text-muted">{view === "completed" ? "Trafią tutaj realizacje, dla których wybierzesz „Zakończ realizację”." : "Zapisz nową wycenę lub przywróć zakończoną realizację do aktywnych."}</p>
        </div>
      )}
      {quotes && quotes.length > 0 && (
        <ul aria-label="Zapisane wyceny" className="space-y-3">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <Link href={`/realizacje/${quote.id}`} className="group block rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_30px_#292c2905] transition-colors hover:border-gold/60 focus-visible:outline-2 focus-visible:outline-gold sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-semibold text-ink">{quote.snapshot.customer.name.trim() || quote.snapshot.customer.nickname?.trim() || "Nie podano klienta"}</h2>
                    <p className="mt-1 break-words text-sm leading-6 text-muted">{quoteProductName(quote.snapshot)}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full border border-gold/20 bg-gold-soft px-3 py-1.5 text-xs font-medium text-ink">{quote.status}</span>
                    <ArrowUpRight size={18} className="hidden text-gold sm:block" aria-hidden="true" />
                  </span>
                </div>
                <div className="mt-3"><HistoricalQuoteBadge date={quote.snapshot.customer.quoteDate} enteredDate={getQuoteDate(new Date(quote.createdAt))} /></div>
                <dl className="mt-5 grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-muted">Data wyceny</dt><dd className="mt-1 text-ink">{displayDate(quote.snapshot.customer.quoteDate)}</dd></div>
                  <div><dt className="text-xs text-muted">Termin wykonania</dt><dd className="mt-1 text-ink">{displayDate(quote.dueDate)}</dd></div>
                  <div className="sm:text-right"><dt className="text-xs text-muted">{quote.snapshot.totals.manualPrice ? "Cena ustalona · brutto" : "Cena brutto"}</dt><dd className="mt-1 font-semibold text-gold tabular-nums">{formatMoney(quote.snapshot.totals.gross)}</dd></div>
                </dl>
                {quote.completedAt && <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">Data zakończenia: <time dateTime={quote.completedAt}>{displayTimestamp(quote.completedAt)}</time></p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6"><LocalStorageNotice /></div>
    </section>
  );
}
