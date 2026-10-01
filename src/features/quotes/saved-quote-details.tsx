"use client";

import Link from "next/link";
import { getQuoteDate } from "./defaults";
import { HistoricalQuoteBadge } from "./components/historical-quote-badge";
import { ArrowLeft, CheckCircle2, Pencil } from "lucide-react";
import { useLocalQuote } from "./data/use-local-quotes";
import { displayTimestamp, quoteProductName } from "./data/presentation";
import { LocalDataError, LocalStorageNotice } from "./components/local-data-state";
import { SavedCustomerAndProduct, SavedPricingSections } from "./components/saved-quote-snapshot";
import { ProductOrderSummary } from "./components/product-order-summary";
import { draftFromQuote } from "./data/snapshot";
import { SavedQuoteSummary } from "./components/saved-quote-summary";
import { QuoteMetadataEditor } from "./components/quote-metadata-editor";
import { QuoteCompletionAction } from "./components/quote-completion-action";
import { QuotePhotoGallery } from "./photos/quote-photo-gallery";
import { QuoteSyncNotice } from "../sync/quote-sync-notice";

export function SavedQuoteDetails({ id }: { id: string }) {
  const { result, retry } = useLocalQuote(id);
  const quote = result?.data;
  return <section aria-labelledby="page-title">
    <Link href="/realizacje" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-ink"><ArrowLeft size={17} aria-hidden="true" />Wróć do realizacji</Link>
    <div className="mb-6">
      <span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true" />
      <h1 id="page-title" className="font-display text-4xl leading-tight font-medium tracking-tight text-ink sm:text-5xl">Szczegóły wyceny</h1>
      {quote && <p className="mt-3 break-words text-sm leading-6 text-muted">{quote.snapshot.customer.name.trim() || quote.snapshot.customer.nickname?.trim() || "Nie podano klienta"} · {quoteProductName(quote.snapshot)}</p>}
      {quote && <div className="mt-3"><HistoricalQuoteBadge date={quote.snapshot.customer.quoteDate} enteredDate={getQuoteDate(new Date(quote.createdAt))} /></div>}
      {quote && <Link href={`/realizacje/${quote.id}/edytuj`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-sidebar px-4 py-3 text-sm font-semibold text-sidebar-text hover:bg-sidebar-active"><Pencil size={17} aria-hidden="true" />Edytuj realizację</Link>}
    </div>
    {!result && <p role="status" className="text-sm text-muted">Wczytywanie zapisanej wyceny…</p>}
    {result?.error && <LocalDataError message={result.error} onRetry={retry} />}
    {result && !result.error && !quote && <div className="rounded-2xl border border-line bg-surface p-6"><h2 className="font-display text-3xl text-ink">Nie znaleziono wyceny</h2><p className="mt-3 text-sm leading-6 text-muted">Ten rekord nie jest dostępny w lokalnej bazie tej przeglądarki. Sprawdź, czy używasz urządzenia, profilu i adresu aplikacji, w których zapisano wycenę.</p></div>}
    {quote && <>
      <p role="status" className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 size={18} className="shrink-0" aria-hidden="true" />Wycena zapisana lokalnie na tym urządzeniu.</p>
      <div className="mb-6"><ProductOrderSummary draft={draftFromQuote(quote)} model={quote.snapshot.modelName} /></div>
      <QuoteCompletionAction key={quote.id} quote={quote} />
      <QuoteSyncNotice key={`sync-${quote.id}`} quote={quote} />
      <QuotePhotoGallery key={`photos-${quote.id}`} quoteId={quote.id} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-6">
          <QuoteMetadataEditor key={quote.id} quote={quote} />
          <SavedCustomerAndProduct snapshot={quote.snapshot} />
          <SavedPricingSections snapshot={quote.snapshot} />
        </div>
        <SavedQuoteSummary snapshot={quote.snapshot} />
      </div>
      <details className="mt-6 rounded-xl border border-line bg-surface p-4 text-xs leading-6 text-muted">
        <summary className="cursor-pointer font-medium text-ink">Informacje o lokalnym zapisie</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><dt>ID wyceny</dt><dd className="break-all font-mono text-ink">{quote.id}</dd></div>
          <div><dt>Utworzono</dt><dd className="text-ink">{displayTimestamp(quote.createdAt)}</dd></div>
          <div><dt>Ostatnia zmiana</dt><dd className="text-ink">{displayTimestamp(quote.updatedAt)}</dd></div>
          <div><dt>Przechowywanie</dt><dd className="text-ink">Lokalnie · wersja rekordu {quote.revision}</dd></div>
        </dl>
      </details>
    </>}
    <div className="mt-6"><LocalStorageNotice /></div>
  </section>;
}
