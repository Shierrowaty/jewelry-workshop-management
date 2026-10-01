import { calculateGoldSettlement, formatDecimal } from "../calculations";
import type { GoldDraft, QuoteDraft } from "../types";

function DataRows({ rows }: { rows: [string, string | undefined][] }) {
  return <dl className="grid gap-4 sm:grid-cols-2">{rows.map(([label, value], index) => <div key={`${label}-${index}`} className="min-w-0 text-sm"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words whitespace-pre-wrap">{value || "—"}</dd></div>)}</dl>;
}

export function CustomerGoldSummary({ gold, compact = false }: { gold: GoldDraft; compact?: boolean }) {
  if (gold.source === "ours") return null;
  const grams = (value: number) => `${formatDecimal(value / 1000, 3)} g`;
  const rows: [string, string | undefined][] = (gold.customerLots ?? []).map((lot, i) => [`Złoto klienta ${i + 1} · próba ${lot.fineness}`, `${lot.mass || "0"} g`]);
  const { value } = calculateGoldSettlement(gold);
  if (gold.settlementVersion && value) rows.push(
    ["Łączna masa fizyczna", grams(value.physicalMilligrams)],
    ["Czyste Au", grams(value.pureMilligrams)],
    ["Średnia próba", value.averageFineness === null ? "—" : formatDecimal(value.averageFineness, 3)],
    ["Docelowa próba", String(value.targetFineness)],
    ["Waga po przeliczeniu", grams(value.convertedMilligrams)],
    ["Szacowana waga do wykonania", grams(value.estimatedMilligrams)],
    ["Ubytek technologiczny", `${value.lossPercent}% · ${grams(value.lossMilligrams)}`],
    ["Masa do rozliczenia", grams(value.requiredMilligrams)],
    ["Saldo złota klienta", grams(value.balanceMilligrams)],
    [value.balanceMilligrams < 0 ? "Brakuje złota" : value.balanceMilligrams > 0 ? "Pozostaje klientowi" : "Złoto rozliczone", grams(Math.abs(value.balanceMilligrams))],
  );
  if (compact && gold.settlementVersion && value) return <div className="space-y-4">
    <p className="text-sm font-semibold">Po przeliczeniu: {grams(value.convertedMilligrams)} próby docelowej {value.targetFineness}</p>
    <div role="status" aria-live="polite" className={`rounded-xl border p-4 text-base font-semibold ${value.balanceMilligrams < 0 ? "border-red-200 bg-red-50 text-red-900" : value.balanceMilligrams > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-line bg-canvas text-ink"}`}>
      {value.balanceMilligrams < 0 ? `Brakuje ${grams(-value.balanceMilligrams)} złota próby ${value.targetFineness}` : value.balanceMilligrams > 0 ? `Pozostaje ${grams(value.balanceMilligrams)} złota próby ${value.targetFineness}` : `Złoto próby ${value.targetFineness} rozliczone — saldo 0,000 g`}
    </div>
    <details className="rounded-lg border border-line bg-white/60 p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">Szczegóły przeliczenia złota</summary>
      <DataRows rows={rows.slice(0, -1)} />
    </details>
  </div>;
  return <div className="space-y-3"><DataRows rows={rows} />{!gold.settlementVersion && <p className="text-sm text-muted">Wycena ze starszego kalkulatora — nie zapisano przeliczenia prób ani ubytku. Masa złota klienta: {gold.customerLots && value ? grams(value.physicalMilligrams) : `${(gold.source === "customer" ? gold.mass : gold.customerMass) || "0"} g`}.</p>}{gold.settlementVersion && !value && <p className="text-sm text-red-800">Popraw próby i masy, aby obliczyć saldo.</p>}</div>;
}

export function ProductOrderSummary({ draft, model, title = "Podsumowanie produktu" }: { draft: QuoteDraft; model?: string; title?: string }) {
  const { customer, product, gold } = draft;
  const rows: [string, string | undefined][] = [
    ["Klient / pseudonim", [customer.name, customer.nickname].filter(Boolean).join(" · ")],
    ["Model / nazwa produktu", product.customDesign ? product.customName : model || product.modelId],
    ["Data zlecenia", customer.quoteDate], ["Termin realizacji", customer.dueDate],
    ["Rozmiar", product.size], ["Próba złota", gold.fineness],
    ["Waga produktu", `${(product.weight ?? gold.mass) || "0"} g`],
    ["Krótki opis wariantu", product.variant], ["Uwagi / opisy", customer.notes],
  ];
  if (product.twoColors) rows.push(["Kolor 1 / element", product.colorOne], ["Kolor 2 / element", product.colorTwo]);
  else rows.push(["Kolor złota", product.goldColor ?? gold.color]);
  for (const line of [...draft.labor, ...draft.otherCosts]) if (line.name) rows.push(["Opis pozycji", line.name]);
  return <details open className="rounded-xl border border-amber-200 bg-amber-50 p-4">
    <summary className="min-h-11 cursor-pointer font-semibold">{title}</summary>
    <div className="space-y-5"><DataRows rows={rows} />
      <div className="space-y-4"><h3 className="text-sm font-semibold">Kamienie</h3>{!draft.stones.length && <p className="text-sm text-muted">Nie dodano kamieni.</p>}{draft.stones.map((stone, i) => <div key={stone.id} className="rounded-lg border border-amber-200 p-3"><DataRows rows={[["Nazwa", stone.name || `Kamień ${i + 1}`], ["Ilość", stone.quantity], ["Karaty", stone.carats ? `${stone.carats} ct` : undefined], ["Kształt", stone.shape], ["Wymiary", stone.dimensions]]} /></div>)}</div>
      {gold.source !== "ours" && <div className="space-y-3 border-t border-amber-200 pt-4"><h3 className="text-sm font-semibold">Złoto klienta</h3><CustomerGoldSummary gold={gold} /></div>}
    </div>
  </details>;
}
