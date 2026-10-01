"use client";

import { useRef, useState } from "react";
import { Archive, RotateCcw } from "lucide-react";
import type { SavedQuote } from "../data/types";
import { getQuoteRepository } from "../data/quote-repository";
import { localDataError } from "../data/storage";
import { displayTimestamp } from "../data/presentation";

export function QuoteCompletionAction({ quote }: { quote: SavedQuote }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const completed = quote.completedAt !== null;
  async function changeCompletion() {
    if (inFlight.current) return;
    const question = completed
      ? "Przywrócić tę realizację do aktywnych? Jej dane, ceny i status pozostaną bez zmian."
      : "Zakończyć tę realizację? Trafi do zakładki „Zakończone”. Jej dane, ceny i status pozostaną zachowane. Możesz ją później przywrócić.";
    if (!window.confirm(question)) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await getQuoteRepository().setCompleted(quote.id, quote.revision, !completed);
      setMessage(completed ? "Realizacja została przywrócona do aktywnych i zapisana lokalnie." : "Realizacja została zakończona i zapisana lokalnie. Znajdziesz ją w zakładce „Zakończone”.");
    } catch (error) {
      setError(localDataError(error));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const Icon = completed ? RotateCcw : Archive;
  return <div className="mb-6 rounded-2xl border border-line bg-surface p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-semibold text-ink">{completed ? "Realizacja zakończona" : "Realizacja aktywna"}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{quote.completedAt ? `Zakończono: ${displayTimestamp(quote.completedAt)}.` : "Zakończenie przenosi realizację do historii, niezależnie od jej statusu."}</p>
      </div>
      <button type="button" disabled={saving} onClick={() => void changeCompletion()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gold/30 bg-gold-soft px-4 py-3 text-sm font-semibold text-[#795b24] hover:border-gold/60 disabled:cursor-wait disabled:opacity-60"><Icon size={17} aria-hidden="true" />{saving ? "Zapisywanie lokalnie…" : completed ? "Przywróć do aktywnych" : "Zakończ realizację"}</button>
    </div>
    {message && <p role="status" className="mt-4 text-sm leading-6 text-emerald-900">{message}</p>}
    {error && <p role="alert" className="mt-4 text-sm leading-6 text-red-800">Zmiana nie została zapisana. {error}</p>}
  </div>;
}
