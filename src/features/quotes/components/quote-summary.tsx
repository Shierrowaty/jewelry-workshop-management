import { ProductOrderSummary } from "./product-order-summary";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { formatMoney } from "../calculations";
import type { ProductCatalog, QuoteCalculation, QuoteDraft } from "../types";
import { priceInput } from "../pricing-draft";
import { NumericField } from "./fields";

function SummaryRow({ label, amount, prominent = false }: { label: string; amount: number | null | undefined; prominent?: boolean }) {
  return <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 ${prominent ? "font-semibold text-ink" : "text-muted"}`}>
    <dt className="text-sm leading-5">{label}</dt><dd className="text-sm whitespace-nowrap tabular-nums">{formatMoney(amount)}</dd>
  </div>;
}

export function QuoteSummary({ calculation, draft, catalog, onGrossChange }: {
  calculation: QuoteCalculation; draft: QuoteDraft; catalog: ProductCatalog; onGrossChange: (value: string) => void;
}) {
  const { totals, errors } = calculation;
  const product = draft.product;
  const model = product.customDesign ? product.customName : catalog.models.find(row => row.id === product.modelId)?.name;
  return (
    <section aria-labelledby="quote-summary-title" className="self-start overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_#292c2905] xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto">
      <header className="border-b border-line px-5 py-5">
        <p className="mb-1 text-xs font-semibold tracking-widest text-[#795b24] uppercase">07 · Podsumowanie</p>
        <h2 id="quote-summary-title" className="font-display text-3xl font-medium text-ink">Podsumowanie wyceny</h2>
      </header>
      <div className="space-y-5 p-5">
        <div className="border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold">Koszty netto</h3>
          <dl className="space-y-3">
            <SummaryRow label="Koszt złota" amount={totals?.gold.purchaseCost} />
            <SummaryRow label="Koszt kamieni" amount={totals?.stoneCost} />
            <SummaryRow label="Inne koszty / usługi zewnętrzne" amount={totals?.externalCost} />
            <SummaryRow label="Suma kosztów netto" amount={totals?.totalCost} prominent />
          </dl>
        </div>
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4"><NumericField label="Cena dla klienta brutto" name="agreedGross" unit="PLN" value={draft.pricing?.basis === "gross" ? draft.agreedGross : priceInput(totals?.gross)} error={errors.agreedGross} hint={draft.pricing ? "Zmiana ceny oblicza Twój czysty zysk. VAT 23%." : "Cena zachowana z historycznej wyceny."} onChange={event => onGrossChange(event.target.value)} /></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Czysty zysk</h3><ArrowUpRight size={18} aria-hidden="true" /></div>
          <output aria-live="polite" aria-atomic="true" className="mt-2 block break-words text-2xl font-semibold tabular-nums">{formatMoney(totals?.cleanProfit)}</output>
          <p className="mt-2 text-xs leading-5">Po kosztach netto i szacowanym podatku 12% od dodatniego zysku. Praca własna nie jest kosztem.</p>
        </div>
        <dl className="space-y-3 border-t border-line pt-4">
          <SummaryRow label="Przychód netto" amount={totals?.net} prominent />
          <SummaryRow label={`VAT ${draft.pricing ? "23" : draft.vatRate}%`} amount={totals?.vat} />
          <SummaryRow label="Zysk przed podatkiem" amount={totals?.profit} />
          <SummaryRow label="Szacowany podatek 12%" amount={totals?.estimatedTax} />
        </dl>

        {totals && totals.profit < 0 && <p className="flex items-start gap-2 text-sm text-red-800"><CircleAlert size={17} className="shrink-0" aria-hidden="true" />Cena nie pokrywa kosztów netto. Przy stracie podatek wynosi 0.</p>}
        <ProductOrderSummary draft={draft} model={model} title="Klient i produkt — dane zlecenia" />
        {!totals && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errors.summary ?? "Popraw zaznaczone pola, aby zobaczyć poprawne podsumowanie."}</p>}
      </div>
    </section>
  );
}
