"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { calculateQuote, formatMoney } from "../quotes/calculations";
import { createEmptyQuote } from "../quotes/defaults";
import { changePricing, priceInput } from "../quotes/pricing-draft";
import { NumericField, TextField } from "../quotes/components/fields";
import { GoldSection } from "../quotes/components/gold-section";
import { StonesSection } from "../quotes/components/stones-section";
import { exampleStoneCatalog } from "../quotes/stone-catalog";
import { useUnsavedChanges } from "../quotes/use-unsaved-changes";
import { localDataError, requestPersistentStorage } from "../quotes/data/storage";
import { CalculatorError, getCalculatorRepository, type SavedCalculation } from "./repository";
export const calculatorButton = "inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold disabled:opacity-50";
export function CalculatorEditor({ initialDate, saved }: { initialDate: string; saved?: SavedCalculation }) {
  const [baseline, setBaseline] = useState(() => ({ name: saved?.name ?? "", draft: saved?.draft ?? createEmptyQuote(initialDate) }));
  const [name, setName] = useState(baseline.name), [draft, setDraft] = useState(baseline.draft);
  const [previous, setPrevious] = useState(saved), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const inFlight = useRef(false), router = useRouter();
  const dirty = JSON.stringify({ name, draft }) !== JSON.stringify(baseline);
  const allowNavigation = useUnsavedChanges(dirty, "Masz niezapisane zmiany w kalkulacji. Wyjść bez zapisu?");
  const calculation = calculateQuote(draft), { totals, errors } = calculation;
  async function act(transfer: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      void requestPersistentStorage();
      if (transfer) {
        const record = await getCalculatorRepository().transfer(name, draft);
        allowNavigation(); router.push(`/nowa-wycena/z-kalkulatora/${record.id}`);
      } else {
        const record = await getCalculatorRepository().save(name, draft, previous);
        setPrevious(record); setBaseline({ name: record.name, draft: record.draft }); setName(record.name); setMessage("Kalkulacja zapisana lokalnie.");
      }
    } catch (cause) { setError(cause instanceof CalculatorError ? cause.message : localDataError(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }
  const rows = [["Suma kosztów netto", totals?.totalCost], ["Przychód netto", totals?.net], ["VAT 23%", totals?.vat], ["Zysk przed podatkiem", totals?.profit], ["Szacowany podatek 12%", totals?.estimatedTax]] as const;
  return <section aria-labelledby="page-title" className="mx-auto max-w-4xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true" /><h1 id="page-title" className="font-display text-4xl sm:text-5xl">Kalkulator</h1><p className="mt-3 text-sm text-muted">Sprawdź cenę i zarobek. Zmień cenę brutto lub kwotę, którą chcesz czysto zarobić.</p></div><Link className={calculatorButton} href="/kalkulator/zapisane">Zapisane kalkulacje</Link></header>
    <form noValidate onSubmit={event => { event.preventDefault(); void act(false); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div className="space-y-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <TextField label="Nazwa kalkulacji" value={name} onChange={event => { setName(event.target.value); setMessage(""); }} placeholder="Np. Pierścionek ze szmaragdem" />
          <div className="grid gap-5 sm:grid-cols-2"><NumericField label="Chcę czysto zarobić" unit="PLN" value={draft.pricing?.basis === "cleanProfit" ? draft.pricing.desiredCleanProfit : priceInput(totals?.cleanProfit)} error={errors["pricing.desiredCleanProfit"]} onChange={event => { setDraft(current => changePricing(current, "cleanProfit", event.target.value)); setMessage(""); }} />
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4"><NumericField label="Cena dla klienta brutto" unit="PLN" value={draft.pricing?.basis === "gross" ? draft.agreedGross : priceInput(totals?.gross)} error={errors.agreedGross} onChange={event => { setDraft(current => changePricing(current, "gross", event.target.value)); setMessage(""); }} /></div></div>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{rows.map(([label,amount]) => <div key={label} className="flex flex-wrap justify-between gap-2 text-sm"><dt className="text-muted">{label}</dt><dd className="font-semibold tabular-nums">{formatMoney(amount)}</dd></div>)}</dl>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><h2 className="text-sm font-semibold">Czysty zysk</h2><output aria-live="polite" className="mt-1 block text-3xl font-semibold tabular-nums">{formatMoney(totals?.cleanProfit)}</output><p className="mt-2 text-xs">Po kosztach netto i szacowanym podatku 12% od dodatniego zysku.</p></div>
          {totals && totals.profit < 0 && <p className="text-sm text-red-800">Cena nie pokrywa kosztów netto. Przy stracie podatek wynosi 0.</p>}
          {!totals && <p role="alert" className="text-sm text-red-800">Popraw zaznaczone pola. {Object.keys(errors).some(key => key.startsWith("gold.") || key.startsWith("product.")) && "Sprawdź blok Złoto. "}{Object.keys(errors).some(key => key.startsWith("stones.")) && "Sprawdź blok Kamienie. "}{errors.summary}</p>}
        </div>
        <details className="rounded-2xl border border-line bg-surface p-5 sm:p-6"><summary className="cursor-pointer text-sm font-semibold uppercase">Złoto</summary><div className="mt-5"><GoldSection compact value={draft.gold} productWeight={draft.product.weight ?? ""} calculation={calculation} onWeightChange={weight => setDraft(current => ({ ...current, product: { ...current.product, weight } }))} onChange={patch => setDraft(current => ({ ...current, gold: { ...current.gold, ...patch } }))} /></div></details>
        <details className="rounded-2xl border border-line bg-surface p-5 sm:p-6"><summary className="cursor-pointer text-sm font-semibold uppercase">Kamienie</summary><div className="mt-5"><StonesSection compact items={draft.stones} catalog={exampleStoneCatalog} calculation={calculation} onChange={stones => setDraft(current => ({ ...current, stones }))} /></div></details>
        <div className="flex flex-wrap gap-3"><button type="submit" className={`${calculatorButton} !bg-sidebar !text-sidebar-text`}>{busy ? "Zapisywanie…" : previous ? "Zapisz zmiany" : "Zapisz kalkulację"}</button><button type="button" className={calculatorButton} onClick={() => void act(true)}>Przenieś do Nowej Wyceny</button><button type="button" className={calculatorButton} onClick={() => { if (dirty && !window.confirm("Masz niezapisane zmiany. Rozpocząć nową kalkulację?")) return; setName(""); const fresh = createEmptyQuote(initialDate); setDraft(fresh); setBaseline({ name: "", draft: fresh }); setPrevious(undefined); setMessage(""); setError(""); router.push("/kalkulator"); }}>Nowa kalkulacja</button></div>
      </fieldset>
      {message && !dirty && <p role="status" className="mt-4 text-sm text-emerald-900">{message}</p>}{error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
    </form><p className="text-xs text-muted">Kalkulacje zapisujesz lokalnie na tym urządzeniu, także offline.</p>
  </section>;
}
