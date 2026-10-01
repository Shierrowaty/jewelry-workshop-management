"use client";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDatabase } from "../quotes/data/database";
import { localDataError } from "../quotes/data/storage";
import { QuoteForm } from "../quotes/quote-form";
import { exampleCatalog } from "../quotes/catalog";
export function QuoteFromCalculator({ id }: { id: string }) {
  const result = useLiveQuery(async () => { try { return { transfer: await getLocalDatabase().calculationTransfers.get(id), error: "" }; } catch (error) { return { transfer: undefined, error: localDataError(error) }; } }, [id]);
  if (!result) return <p role="status">Wczytywanie szkicu z kalkulatora…</p>;
  if (!result.transfer || result.error) return <div><p role="alert">{result.error || "Nie znaleziono szkicu z kalkulatora na tym urządzeniu."}</p><Link href="/kalkulator" className="mt-4 inline-block underline">Wróć do kalkulatora</Link></div>;
  return <QuoteForm key={id} catalog={exampleCatalog} initialDate={result.transfer.draft.customer.quoteDate} draftSeed={result.transfer.draft} />;
}
