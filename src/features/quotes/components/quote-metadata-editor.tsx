"use client";

import { useRef, useState } from "react";
import { Save } from "lucide-react";
import { orderStatuses } from "../catalog";
import { getQuoteRepository } from "../data/quote-repository";
import { localDataError, requestPersistentStorage } from "../data/storage";
import type { QuoteMetadata, SavedQuote } from "../data/types";
import { SelectField, TextareaField, TextField } from "./fields";

function metadataOf(quote: SavedQuote): QuoteMetadata {
  return { status: quote.status, dueDate: quote.dueDate, notes: quote.notes };
}

export function QuoteMetadataEditor({ quote }: { quote: SavedQuote }) {
  const [metadata, setMetadata] = useState(() => metadataOf(quote));
  const [baseRevision, setBaseRevision] = useState(quote.revision);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const saveInFlight = useRef(false);
  const stale = baseRevision !== quote.revision;
  const dirty = metadata.status !== quote.status || metadata.dueDate !== quote.dueDate || metadata.notes !== quote.notes;
  // Completion changes the revision without changing this form's three fields.
  if (stale && !dirty && !saving) setBaseRevision(quote.revision);

  function change(patch: Partial<QuoteMetadata>) {
    setMetadata((current) => ({ ...current, ...patch }));
    setSaved(false);
    setError(null);
  }

  async function save() {
    if (saveInFlight.current || stale || !dirty) return;
    saveInFlight.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    void requestPersistentStorage();
    try {
      const updated = await getQuoteRepository().updateMetadata(quote.id, baseRevision, metadata);
      setBaseRevision(updated.revision);
      setSaved(true);
    } catch (error) {
      setError(localDataError(error));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return <section aria-labelledby="order-edit-title" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <h2 id="order-edit-title" className="font-display text-3xl font-medium text-ink">Aktualizacja zamówienia</h2>
    <p className="mt-2 text-sm leading-6 text-muted">Zmień status, termin lub uwagi i zapisz zmiany lokalnie.</p>
    {stale && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <p>W bazie jest nowsza wersja zamówienia. Wczytanie aktualnych danych zastąpi niezapisane zmiany w tych trzech polach.</p>
      <button type="button" disabled={saving} onClick={() => { setMetadata(metadataOf(quote)); setBaseRevision(quote.revision); setError(null); setSaved(false); }} className="mt-2 min-h-11 rounded-lg border border-amber-300 px-3 font-semibold hover:bg-amber-100">Wczytaj aktualne dane</button>
    </div>}
    <form aria-label="Aktualizacja zamówienia" className="mt-5" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-busy={saving}>
      <fieldset disabled={saving} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Status" value={metadata.status} onChange={(event) => change({ status: event.target.value })}>
            {!orderStatuses.includes(metadata.status) && <option>{metadata.status}</option>}
            {orderStatuses.map((status) => <option key={status}>{status}</option>)}
          </SelectField>
          <TextField label="Termin wykonania (opcjonalny)" type="date" value={metadata.dueDate} onChange={(event) => change({ dueDate: event.target.value })} />
        </div>
        <TextareaField label="Uwagi" rows={3} value={metadata.notes} onChange={(event) => change({ notes: event.target.value })} />
        <button type="submit" disabled={stale || !dirty} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sidebar px-4 py-3 text-sm font-semibold text-sidebar-text hover:bg-sidebar-active disabled:cursor-not-allowed disabled:opacity-50"><Save size={17} aria-hidden="true" />{saving ? "Zapisywanie lokalnie…" : "Zapisz zmiany"}</button>
      </fieldset>
      {dirty && !saved && <p className="mt-3 text-xs text-muted">Masz niezapisane zmiany w zamówieniu.</p>}
      {saved && !stale && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Zmiany zostały zapisane lokalnie.</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">Zmiany nie zostały zapisane. {error}</p>}
    </form>
  </section>;
}
