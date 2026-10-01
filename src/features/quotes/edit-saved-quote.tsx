"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProductCatalog } from "./types";
import type { SavedQuote } from "./data/types";
import { catalogForQuote } from "./data/snapshot";
import { useLocalQuote } from "./data/use-local-quotes";
import { QuoteForm } from "./quote-form";
import { LocalDataError } from "./components/local-data-state";

function LoadedEditor({ quote, catalog }: { quote: SavedQuote; catalog: ProductCatalog }) {
  // Live updates signal a conflict but never replace the user's in-progress edits.
  const [base, setBase] = useState(quote);
  return <QuoteForm
    key={`${base.id}:${base.revision}`}
    initialQuote={base}
    catalog={catalogForQuote(catalog, base.snapshot)}
    conflict={quote.revision !== base.revision}
    onReload={() => {
      if (window.confirm("Wczytać aktualną realizację z bazy? Niezapisane zmiany w formularzu zostaną zastąpione.")) setBase(quote);
    }}
  />;
}

export function EditSavedQuote({ id, catalog }: { id: string; catalog: ProductCatalog }) {
  const { result, retry } = useLocalQuote(id);
  if (!result) return <p role="status" className="text-sm text-muted">Wczytywanie realizacji do edycji…</p>;
  if (result.error) return <LocalDataError message={result.error} onRetry={retry} />;
  if (!result.data) return <section className="rounded-2xl border border-line bg-surface p-6">
    <h1 className="font-display text-3xl text-ink">Nie znaleziono realizacji</h1>
    <p className="mt-3 text-sm text-muted">Sprawdź urządzenie, profil przeglądarki i adres aplikacji użyte przy zapisie.</p>
    <Link href="/realizacje" className="mt-4 inline-block py-3 text-sm font-semibold text-gold underline">Wróć do realizacji</Link>
  </section>;
  return <LoadedEditor key={id} quote={result.data} catalog={catalog} />;
}
