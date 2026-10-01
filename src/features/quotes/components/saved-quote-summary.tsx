import { formatDecimal, formatMoney } from "../calculations";
import type { QuoteSnapshot } from "../data/types";

function Amount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-sm ${strong ? "font-semibold text-ink" : "text-muted"}`}><dt>{label}</dt><dd className="whitespace-nowrap tabular-nums">{formatMoney(value)}</dd></div>;
}

export function SavedQuoteSummary({ snapshot }: { snapshot: QuoteSnapshot }) {
  const totals = snapshot.totals;
  if (snapshot.pricing) return <section aria-labelledby="saved-summary-title" className="space-y-5 rounded-2xl border border-line bg-surface p-5">
    <h2 id="saved-summary-title" className="font-display text-3xl font-medium">Zapisana wycena</h2>
    <p className="text-xs text-muted">Kwoty zachowane w chwili zapisu.</p>
    <dl className="space-y-3">
      <Amount label="Koszt złota netto" value={totals.gold.purchaseCost} />
      <Amount label="Koszt kamieni netto" value={totals.stoneCost} />
      <Amount label="Inne koszty netto" value={totals.externalCost} />
      <Amount label="Suma kosztów netto" value={totals.totalCost} strong />
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4"><Amount label="Cena dla klienta brutto" value={totals.gross} strong /></div>
      <Amount label="Przychód netto" value={totals.net} />
      <Amount label="VAT 23%" value={totals.vat} />
      <Amount label="Zysk przed podatkiem" value={totals.profit} />
      <Amount label="Szacowany podatek 12%" value={totals.estimatedTax ?? 0} />
    </dl>
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><h3 className="text-sm font-semibold">Czysty zysk</h3><p className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(totals.cleanProfit)}</p></div>
  </section>;
  return (
    <section aria-labelledby="saved-summary-title" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_#292c2905]">
      <header className="border-b border-line p-5">
        <p className="mb-1 text-xs font-semibold tracking-widest text-[#795b24] uppercase">07 · Podsumowanie</p>
        <h2 id="saved-summary-title" className="font-display text-3xl font-medium text-ink">Zapisana wycena</h2>
        <p className="mt-2 text-xs leading-5 text-muted">Kwoty zachowane w chwili zapisu. Późniejsze zmiany cen nie wpływają na tę wycenę.</p>
      </header>
      <div className="space-y-5 p-5">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-ink">Koszty</h3>
          <dl className="space-y-3">
            <Amount label="Koszt złota" value={totals.gold.purchaseCost} />
            <Amount label="Koszt kamieni" value={totals.stoneCost} />
            <Amount label="Materiały łącznie" value={totals.materialCost} />
            <Amount label="Inne koszty / usługi zewnętrzne" value={totals.externalCost} />
            <div className="border-t border-line pt-3"><Amount label="Łączny koszt" value={totals.totalCost} strong /></div>
          </dl>
        </div>
        <div className="border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Planowany zarobek</h3>
          <dl className="space-y-3">
            <Amount label="Zarobek na złocie" value={totals.gold.profit} />
            <Amount label="Zarobek na kamieniach" value={totals.stoneProfit} />
            <Amount label="Robocizna / zarobek za wykonanie" value={totals.labor} />
          </dl>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <h3 className="text-sm font-semibold">Planowany zarobek na zleceniu</h3>
          <p className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatMoney(totals.plannedProfit)}</p>
          <p className="mt-2 text-xs leading-5">Planowana marża w cenie netto: {totals.plannedMarginPercent == null ? "—" : `${formatDecimal(totals.plannedMarginPercent, 1)}%`}.</p>
          <p className="mt-2 text-xs leading-5">Przed kosztem pracy własnej i kosztami stałymi.</p>
        </div>
        <dl className="space-y-3 border-t border-line pt-4">
          {totals.manualPrice && <>
            <Amount label="Cena netto z planu" value={totals.calculatedNet} />
            <Amount label="Cena brutto z planu" value={totals.calculatedGross} />
            <Amount label="Korekta ceny netto" value={totals.priceAdjustment} />
          </>}
          <Amount label="Cena netto" value={totals.net} strong />
          <Amount label={`VAT (${snapshot.vatRate.trim() || "0"}%)`} value={totals.vat} />
          <div className="rounded-xl bg-gold-soft p-4">
            <dt className="text-sm text-ink">Cena brutto dla klienta</dt>
            <dd className="mt-2 break-words text-2xl font-semibold text-gold tabular-nums">{formatMoney(totals.gross)}</dd>
          </div>
          <div className="text-sm"><dt className="text-muted">Cena ustalona z klientem</dt><dd className="mt-1 font-medium text-ink">{totals.manualPrice ? formatMoney(totals.gross) : "Nie wpisano — obowiązuje cena wyliczona"}</dd></div>
        </dl>
        {totals.manualPrice && <div className={`rounded-xl border p-4 ${totals.profit < 0 ? "border-red-200 bg-red-50" : "border-line bg-canvas"}`}>
          <dl className="space-y-3"><Amount label="Zarobek przy cenie ustalonej" value={totals.profit} strong /></dl>
          <p className="mt-2 text-xs leading-5 text-muted">Marża przy cenie ustalonej: {totals.marginPercent == null ? "—" : `${formatDecimal(totals.marginPercent, 1)}%`}.</p>
          {totals.profit < 0 && <p className="mt-2 text-sm text-red-800">Cena ustalona nie pokrywa kosztów zlecenia.</p>}
        </div>}
      </div>
    </section>
  );
}
