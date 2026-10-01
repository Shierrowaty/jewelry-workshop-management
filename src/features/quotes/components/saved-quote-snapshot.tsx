import { CustomerGoldSummary } from "./product-order-summary";
import { StonePrices } from "./stone-prices";
import type { ReactNode } from "react";
import { formatDecimal, formatMoney } from "../calculations";
import { displayDate } from "../data/presentation";
import type { QuoteSnapshot } from "../data/types";
import type { CostLineDraft } from "../types";
import { FormSection } from "./form-section";

function Value({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs leading-5 text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{children || "Nie podano"}</dd></div>;
}

function entered(value: string, unit: string) {
  return `${value.trim() || "0"} ${unit}`;
}

function SavedCostLines({ items }: { items: CostLineDraft[] }) {
  if (!items.length) return <p className="text-sm text-muted">Nie dodano pozycji.</p>;
  return <ul className="divide-y divide-line">{items.map((item, index) => <li key={item.id} className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"><span className="break-words text-sm text-ink">{item.name || `Pozycja ${index + 1}`}</span><span className="shrink-0 text-sm text-ink tabular-nums">{entered(item.amount, "PLN netto")}</span></li>)}</ul>;
}

export function SavedCustomerAndProduct({ snapshot }: { snapshot: QuoteSnapshot }) {
  return <><FormSection number="01" title="Klient" description="Dane zachowane wraz z wyceną.">
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <Value label="Klient">{snapshot.customer.name || snapshot.customer.nickname}</Value>
      {snapshot.customer.nickname && <Value label="Pseudonim">{snapshot.customer.nickname}</Value>}
      <Value label="Data wyceny">{displayDate(snapshot.customer.quoteDate)}</Value>
      <Value label="Kanał kontaktu">{snapshot.customer.channel}</Value>
      <Value label="Dane kontaktowe">{snapshot.customer.contact}</Value>
    </dl>
  </FormSection>
  <FormSection number="02" title="Produkt" description="Nazwy i opis z chwili zapisu wyceny.">
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <Value label="Kategoria">{snapshot.categoryName || snapshot.product.categoryId}</Value>
      <Value label="Model">{snapshot.modelName || snapshot.product.modelId}</Value>
      <Value label="Projekt indywidualny">{snapshot.product.customDesign ? "Tak" : "Nie"}</Value>
      <Value label="Nazwa projektu indywidualnego">{snapshot.product.customName}</Value>
      {snapshot.pricing && <>
        <Value label="Rozmiar">{snapshot.product.size}</Value>
        {!snapshot.product.twoColors && <Value label="Kolor złota">{snapshot.product.goldColor}</Value>}
        <Value label="Waga produktu">{entered(snapshot.product.weight ?? "", "g")}</Value>
        {snapshot.product.twoColors && <><Value label="Kolor 1 / element">{snapshot.product.colorOne}</Value><Value label="Kolor 2 / element">{snapshot.product.colorTwo}</Value></>}
      </>}
      <div className="sm:col-span-2"><Value label="Krótki opis wariantu">{snapshot.product.variant}</Value></div>
    </dl>
  </FormSection></>;
}

export function SavedPricingSections({ snapshot }: { snapshot: QuoteSnapshot }) {
  const { gold, totals } = snapshot;
  const goldSources = { ours: "Nasze złoto", customer: "Złoto klienta", mixed: "Częściowo złoto klienta" };
  if (snapshot.pricing) return <>
    <FormSection number="03" title="Złoto" description="Parametry z chwili zapisu wyceny.">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Value label="Źródło złota">{goldSources[gold.source]}</Value>
        <Value label="Próba złota">{gold.fineness}</Value>
        <Value label="Waga produktu">{entered(snapshot.product.weight ?? gold.mass, "g")}</Value>
        <Value label="Masa naszego złota w wycenie">{formatDecimal(totals.gold.ourMassMilligrams / 1000, 3)} g</Value>
        <Value label="Cena zakupu za gram">{entered(gold.purchasePerGram, "PLN/g")}</Value>
        <Value label="Koszt złota netto">{formatMoney(totals.gold.purchaseCost)}</Value>
      </dl>
      <CustomerGoldSummary gold={gold} compact />
    </FormSection>
    <FormSection number="04" title="Kamienie" description="Zapisane rzeczywiste koszty netto.">
      {!snapshot.stones.length && <p className="text-sm text-muted">Nie dodano kamieni.</p>}
      {snapshot.stones.map(stone => <div key={stone.id} className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold">{stone.name || "Kamień"}</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <Value label="Ilość">{stone.quantity}</Value><Value label="Waga (karaty)">{entered(stone.carats ?? "", "ct")}</Value>
          <Value label="Kształt">{stone.shape}</Value><Value label="Wymiary">{stone.dimensions}</Value>
          <Value label={stone.priceBasis === "carat" ? "Cena netto za karat" : "Cena netto za sztukę"}>{formatMoney(totals.stones[stone.id]?.costPerUnit)}</Value>
          <div className="sm:col-span-2"><StonePrices net={totals.stones[stone.id]?.totalValue} /></div>
          <Value label="Kamień klienta">{stone.customerOwned ? "Tak" : "Nie"}</Value>
        </dl>
      </div>)}
    </FormSection>
    <FormSection number="05" title="Robocizna / własny zarobek" description="Praca własna nie jest kosztem netto."><dl><Value label="Czysty zysk">{formatMoney(totals.cleanProfit)}</Value></dl></FormSection>
    <FormSection number="06" title="Inne koszty" description="Rzeczywiste koszty netto."><SavedCostLines items={snapshot.otherCosts} /></FormSection>
  </>;
  return <>
    <FormSection number="03" title="Złoto" description="Zapisane parametry i kwoty netto. Masa i ceny z tej wyceny nie zmieniają się wraz z cennikiem.">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Value label="Źródło złota">{goldSources[gold.source]}</Value>
        <Value label="Próba złota">{gold.fineness}</Value>
        <Value label="Kolor złota">{gold.color}</Value>
        <Value label="Szacowana potrzebna masa">{entered(gold.mass, "g")}</Value>
        <Value label="Wpisana masa złota klienta">{entered(gold.customerMass, "g")}</Value>
        <Value label="Masa naszego złota w wycenie">{formatDecimal(totals.gold.ourMassMilligrams / 1000, 3)} g</Value>
        <Value label="Wpisana cena zakupu za gram">{entered(gold.purchasePerGram, "PLN/g")}</Value>
        <Value label="Wpisany zarobek / narzut na gramie">{entered(gold.markupPerGram, "PLN/g")}</Value>
        <Value label="Cena naszego złota dla klienta za gram">{formatMoney(totals.gold.customerPricePerGram)}/g</Value>
        <Value label="Koszt złota">{formatMoney(totals.gold.purchaseCost)}</Value>
        <Value label="Zarobek na złocie">{formatMoney(totals.gold.profit)}</Value>
        <Value label="Wartość złota w wycenie">{formatMoney(totals.gold.customerCharge)}</Value>
      </dl>
      {gold.source === "customer" && <p className="mt-4 text-xs leading-5 text-muted">Dla złota klienta wpisane ceny są zachowane informacyjnie. Nie naliczono kosztu ani zarobku na złocie.</p>}
    </FormSection>
    <FormSection number="04" title="Kamienie" description="Koszt i planowany zarobek dotyczą jednej sztuki; suma uwzględnia zapisaną ilość.">
      {!snapshot.stones.length && <p className="text-sm text-muted">Nie dodano kamieni.</p>}
      <ul className="space-y-4">
        {snapshot.stones.map((stone, index) => {
          const item = totals.stones[stone.id];
          return <li key={stone.id} className="rounded-xl border border-line bg-canvas/60 p-4">
            <h3 className="break-words text-sm font-semibold text-ink">{stone.name || `Kamień ${index + 1}`}</h3>
            <dl className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <Value label="Ilość">{stone.quantity}</Value>
              <Value label="Kamień klienta">{stone.customerOwned ? "Tak" : "Nie"}</Value>
              <Value label="Wpisany koszt zakupu / szt.">{entered(stone.purchasePrice, "PLN")}</Value>
              <Value label="Wpisany planowany zarobek / szt.">{entered(stone.plannedProfit, "PLN")}</Value>
              <Value label="Koszt w wycenie / szt.">{formatMoney(item.costPerUnit)}</Value>
              <Value label="Zarobek w wycenie / szt.">{formatMoney(item.plannedProfitPerUnit)}</Value>
              <Value label="Wartość kamienia w wycenie / szt.">{formatMoney(item.valuePerUnit)}</Value>
              <Value label="Koszt całej pozycji">{formatMoney(item.totalCost)}</Value>
              <Value label="Zarobek całej pozycji">{formatMoney(item.totalProfit)}</Value>
              <Value label="Wartość całej pozycji">{formatMoney(item.totalValue)}</Value>
            </dl>
            {stone.customerOwned && <p className="mt-3 text-xs leading-5 text-muted">Kamień klienta: koszt i zarobek w wycenie wynoszą 0 PLN. Wcześniej wpisane kwoty nie są naliczane. Oprawa jest ujmowana osobno w robociźnie.</p>}
          </li>;
        })}
      </ul>
    </FormSection>
    <FormSection number="05" title="Robocizna / zarobek za wykonanie" description="Zapisane pozycje planowanego zarobku netto."><SavedCostLines items={snapshot.labor} /></FormSection>
    <FormSection number="06" title="Inne koszty" description="Zapisane koszty zewnętrzne doliczone do ceny netto."><SavedCostLines items={snapshot.otherCosts} /></FormSection>
  </>;
}
