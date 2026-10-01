import { useState } from "react";
import { formatMoney, parseDecimal } from "../quotes/calculations";
import { displayDate, displayTimestamp } from "../quotes/data/presentation";
import { StonePrices } from "../quotes/components/stone-prices";
import { departmentName, entryGroupName } from "./catalog";
import { calculateKnowledge } from "./calculations";
import { getKnowledgeRepository } from "./repository";
import type { KnowledgeCategory, KnowledgeEntry } from "./types";
import { knowledgeError } from "./use-knowledge";

export function EntryCard({ entry, categories, managing = false, onEdit }: { entry: KnowledgeEntry; categories: KnowledgeCategory[]; managing?: boolean; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `${departmentName(entry.kind)} → ${entryGroupName(entry, categories)}`;
  const money = (raw: string) => raw.trim() ? formatMoney(Number(parseDecimal(raw))) : "—";
  const rows: [string, string][] = entry.kind === "stone" ? [
    ["Dostawca", entry.supplier], ["Rodzaj / nazwa kamienia", entry.name], ["Kształt", entry.shape], ["Wymiary", entry.dimensions], ["Waga (ct)", entry.carats ? `${entry.carats} ct` : ""],
    ["Sposób ceny", entry.priceBasis === "carat" ? "Za karat" : "Za sztukę"], [entry.priceBasis === "carat" ? "Cena netto za karat" : "Cena netto za sztukę", money(entry.unitNetPrice)],
  ] : [["Nazwa produktu", entry.name], ["Dział / Grupa", path], ["Waga referencyjna", entry.referenceWeight ? `${entry.referenceWeight} g` : ""], ["Próba złota", entry.fineness], ["Kolor złota", entry.goldColor],
    ["Cena złota za gram w momencie wpisu", money(entry.goldPricePerGram)], ["Koszt materiału", money(entry.materialCost)], ["Cena wykonania / robocizny", money(entry.laborPrice)], ["Cena gotowego produktu", money(entry.finishedPrice)]];
  rows.push(["Uwagi", entry.notes], ["Data wpisu", displayDate(entry.entryDate)], ["Data utworzenia", displayTimestamp(entry.createdAt)], ["Ostatnia aktualizacja", displayTimestamp(entry.updatedAt)]);
  async function action(remove = false) {
    if (busy || remove && !window.confirm(`Usunąć trwale rekord „${entry.name}”?`)) return;
    setBusy(true); setError("");
    try {
      const repository = getKnowledgeRepository();
      if (remove) await repository.remove(entry.id, entry.revision);
      else await repository.setArchived(entry.id, entry.revision, !entry.archivedAt);
    } catch (error) { setError(knowledgeError(error)); }
    finally { setBusy(false); }
  }
  return <article aria-label={entry.name} className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_30px_#292c2905]">
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-gold-soft px-3 py-1.5 font-semibold">{entry.kind === "stone" ? "Kamień" : "Wyrób"}</span>{entry.archivedAt && <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">Archiwum</span>}<span className="break-words text-muted">{path}</span></div>
    <h2 className="break-words font-display text-3xl">{entry.name}</h2>
    {entry.kind === "stone" ? <div className="mt-4"><StonePrices net={calculateKnowledge(entry).stone?.net} /></div> : <p className="mt-3 text-sm text-muted">Cena gotowego produktu: <strong className="text-ink">{money(entry.finishedPrice)}</strong></p>}
    <details className="mt-4 border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold">Szczegóły rekordu</summary>
      <dl className="grid gap-4 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words whitespace-pre-wrap text-sm">{value || "—"}</dd></div>)}</dl>
    </details>
    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
      <button disabled={busy} onClick={onEdit} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold hover:bg-gold-soft">Edytuj</button>
      {managing && <><button disabled={busy} onClick={() => void action()} className="min-h-11 rounded-lg border border-line px-4 text-sm hover:bg-gold-soft">{entry.archivedAt ? "Przywróć" : "Archiwizuj"}</button>
      <button disabled={busy} onClick={() => void action(true)} className="min-h-11 rounded-lg border border-red-200 px-4 text-sm text-red-800 hover:bg-red-50">Usuń</button></>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
  </article>;
}
