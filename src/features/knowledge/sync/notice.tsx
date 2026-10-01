"use client";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { CloudKnowledgeWrite } from "@/lib/supabase/database.types";
import { getLocalDatabase } from "../../quotes/data/database";
import { LocalKnowledgeSync } from "./local";
import { useQuoteSync } from "../../sync/sync-provider";
import type { KnowledgeSyncState } from "./types";
const labels: Record<string, string> = {
  kind: "Dział", name: "Nazwa", parentId: "Dział grupy", categoryId: "Dział / Grupa", subcategoryId: "Grupa", notes: "Uwagi", entryDate: "Data wpisu",
  supplier: "Dostawca", shape: "Kształt", dimensions: "Wymiary", carats: "Waga (ct)", priceBasis: "Sposób ceny", unitNetPrice: "Cena netto za karat / sztukę",
  referenceWeight: "Waga referencyjna", fineness: "Próba złota", goldColor: "Kolor złota", goldPricePerGram: "Cena złota za gram",
  materialCost: "Koszt materiału", laborPrice: "Robocizna", finishedPrice: "Cena gotowego produktu", archivedAt: "Data archiwizacji",
};
function Preview({ title, row, categories }: { title: string; row: CloudKnowledgeWrite | null; categories: { id: string; name: string }[] }) {
  const data = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
  function display(key: string, value: unknown) {
    if (value === null || value === "") return "—";
    if (["parentId", "categoryId", "subcategoryId"].includes(key)) return categories.find(category => category.id === value)?.name ?? "Nieznana grupa";
    if (key === "kind") return value === "stone" ? "Kamień" : "Wyrób";
    if (key === "priceBasis") return value === "carat" ? "Za karat" : "Za sztukę";
    return String(value);
  }
  return <div className="min-w-0 rounded-lg border border-amber-200 bg-white/60 p-3"><p className="font-semibold">{title}: {row?.deleted_at || !row ? "Usunięty rekord" : String(data.name ?? "Rekord")}</p><p className="text-xs">{row ? new Date(row.updated_at).toLocaleString("pl-PL") : ""}</p><details className="mt-2"><summary className="cursor-pointer">Pełne dane wersji</summary><dl className="mt-2 space-y-2 text-xs">{Object.entries(labels).filter(([key]) => key in data).map(([key, label]) => <div key={key}><dt className="text-muted">{label}</dt><dd className="whitespace-pre-wrap break-words">{display(key, data[key])}</dd></div>)}</dl></details></div>;
}
export function KnowledgeSyncNotice() {
  const { controller, view } = useQuoteSync();
  const result = useLiveQuery(async () => { try { return { data: await new LocalKnowledgeSync(getLocalDatabase()).summary(), categories: await getLocalDatabase().knowledgeCategories.toArray(), error: "" }; } catch { return { data: null, error: "Nie można odczytać stanu synchronizacji Bazy wiedzy." }; } }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function resolve(state: KnowledgeSyncState, token: string, choice: "local" | "cloud") {
    setBusy(true); setError("");
    try {
      const binding = view.summary?.binding;
      if (!binding || !navigator.locks) throw new Error("Połącz pracownię, aby rozstrzygnąć konflikt.");
      await navigator.locks.request("jwm-knowledge-sync", () => new LocalKnowledgeSync(getLocalDatabase()).resolve(state, token, choice, binding));
      void controller.synchronize();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Nie udało się rozstrzygnąć konfliktu."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 text-sm">
    <p className="text-muted">Zapis lokalny działa także offline. Po połączeniu pracowni Baza wiedzy jest wspólna dla jej użytkowników. Oczekujące zmiany: {result?.data?.pending.length ?? "—"}.</p>
    {(error || result?.error) && <p role="alert">{error || result?.error}</p>}
    {result?.data?.conflicts.map(({ state, local, token }) => <section key={state.key} aria-label="Konflikt Bazy wiedzy" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-semibold">Ten wpis zmieniono na innym urządzeniu</h2><p>Porównaj obie wersje i wybierz, którą zachować. Druga wersja zostanie zastąpiona.</p>
      <div className="grid gap-3 sm:grid-cols-2"><Preview title="Na tym urządzeniu" row={local} categories={result.categories ?? []} /><Preview title="W pracowni" row={state.conflict} categories={result.categories ?? []} /></div>
      <div className="flex flex-wrap gap-3"><button className="min-h-11 rounded-lg border border-amber-300 px-3 disabled:opacity-50" disabled={busy} onClick={() => void resolve(state, token, "local")}>Zachowaj wersję lokalną</button><button className="min-h-11 rounded-lg border border-amber-300 px-3 disabled:opacity-50" disabled={busy} onClick={() => void resolve(state, token, "cloud")}>Przyjmij wersję z pracowni</button></div>
    </section>)}
  </div>;
}
