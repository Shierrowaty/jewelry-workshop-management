"use client";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getCalculatorRepository } from "./repository";
import { getQuoteDate } from "../quotes/defaults";
import { calculateQuote, formatMoney } from "../quotes/calculations";
import { localDataError } from "../quotes/data/storage";
import { CalculatorEditor, calculatorButton } from "./calculator-editor";
export function SavedCalculations() {
  const result = useLiveQuery(async () => { try { return { records: await getCalculatorRepository().list(), error: "" }; } catch (error) { return { records: [], error: localDataError(error) }; } }, []);
  return <section className="mx-auto max-w-4xl space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><h1 className="font-display text-4xl">Zapisane kalkulacje</h1><Link href="/kalkulator" className={calculatorButton}>Nowa kalkulacja</Link></header>
    {!result && <p role="status">Wczytywanie kalkulacji…</p>}{result?.error && <p role="alert">{result.error}</p>}
    {result && !result.error && !result.records.length && <p className="rounded-xl border border-dashed border-line p-6 text-muted">Nie masz jeszcze zapisanych kalkulacji.</p>}
    <div className="space-y-4">{result?.records.map(record => { const totals = calculateQuote(record.draft).totals; return <article aria-label={record.name} key={record.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{record.name}</h2><p className="mt-1 text-xs text-muted">Aktualizacja: {new Date(record.updatedAt).toLocaleString("pl-PL")}</p><p className="mt-3 text-sm">Cena brutto: {formatMoney(totals?.gross)} · Czysty zysk: {formatMoney(totals?.cleanProfit)}</p></div><Link href={`/kalkulator/${record.id}`} className={calculatorButton}>Edytuj</Link></article>; })}</div>
  </section>;
}
export function EditCalculation({ id }: { id: string }) {
  const result = useLiveQuery(async () => { try { return { record: await getCalculatorRepository().get(id), error: "" }; } catch (error) { return { record: undefined, error: localDataError(error) }; } }, [id]);
  if (!result) return <p role="status">Wczytywanie kalkulacji…</p>;
  if (!result.record || result.error) return <div className="space-y-4"><p role="alert">{result.error || "Nie znaleziono kalkulacji na tym urządzeniu."}</p><Link href="/kalkulator/zapisane" className={calculatorButton}>Zapisane kalkulacje</Link></div>;
  return <CalculatorEditor key={id} initialDate={getQuoteDate(new Date())} saved={result.record} />;
}
