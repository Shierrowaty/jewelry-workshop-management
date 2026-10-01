import { formatMoney } from "../calculations";
import { CustomerGoldSummary } from "./product-order-summary";
import { goldFinenesses } from "../catalog";
import type { GoldDraft, GoldSource, QuoteCalculation } from "../types";
import { NumericField, SelectField, TextField } from "./fields";
import { AddButton, FormSection, RemoveButton } from "./form-section";

const sources: { value: GoldSource; label: string }[] = [
  { value: "ours", label: "Nasze złoto" },
  { value: "customer", label: "Złoto klienta" },
  { value: "mixed", label: "Częściowo złoto klienta" },
];

export function GoldSection({ value, productWeight, calculation, onChange, compact = false, onWeightChange }: {
  compact?: boolean; onWeightChange?: (value: string) => void;
  value: GoldDraft; productWeight: string; calculation: QuoteCalculation; onChange: (patch: Partial<GoldDraft>) => void;
}) {
  const { totals, errors } = calculation;
  const lots = value.customerLots ?? [];
  const updateLot = (id: string, patch: Partial<(typeof lots)[number]>) => onChange({ customerLots: lots.map(lot => lot.id === id ? { ...lot, ...patch } : lot) });
  return (
    <FormSection number="03" title="Złoto" embedded={compact}>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Pochodzenie złota</legend>
        <div className="flex flex-wrap gap-2">
          {sources.map(source => <label key={source.value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${value.source === source.value ? "border-gold/45 bg-gold-soft font-medium text-[#795b24]" : "border-line text-muted"}`}>
            <input type="radio" name="goldSource" value={source.value} checked={value.source === source.value} onChange={() => onChange({ source: source.value })} className="size-4 accent-gold" />{source.label}
          </label>)}
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Próba złota" name="goldFineness" value={value.fineness} error={errors["gold.fineness"]} onChange={event => onChange({ fineness: event.target.value })}>
          {!goldFinenesses.includes(value.fineness) && <option>{value.fineness}</option>}
          {goldFinenesses.map(fineness => <option key={fineness}>{fineness}</option>)}
        </SelectField>
        <NumericField label={onWeightChange ? "Masa (g)" : "Waga produktu — z sekcji Produkt"} name="goldProductWeight" unit="g" readOnly={!onWeightChange} value={productWeight} error={errors["product.weight"]} onChange={event => onWeightChange?.(event.target.value)} hint={onWeightChange ? undefined : "Wagę edytujesz tylko w sekcji 02."} />
      </div>
      {value.source !== "ours" && <div className="space-y-4 rounded-xl border border-line bg-canvas/40 p-4">
        <h3 className="text-sm font-semibold">Złoto klienta według prób</h3>
        {lots.map((lot, index) => <div key={lot.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <TextField label={`Próba złota klienta ${index + 1}`} name={`lot-${lot.id}-fineness`} value={lot.fineness} error={errors[`gold.lots.${lot.id}.fineness`]} onChange={event => updateLot(lot.id, { fineness: event.target.value })} placeholder="Np. 585" />
          <NumericField label={`Waga złota klienta ${index + 1}`} name={`lot-${lot.id}-mass`} unit="g" value={lot.mass} error={errors[`gold.lots.${lot.id}.mass`]} onChange={event => updateLot(lot.id, { mass: event.target.value })} />
          <RemoveButton label={`Usuń próbę ${index + 1}`} onClick={() => onChange({ customerLots: lots.filter(row => row.id !== lot.id) })} />
        </div>)}
        <AddButton onClick={() => onChange({ customerLots: [...lots, { id: crypto.randomUUID(), fineness: "585", mass: "" }] })}>Dodaj kolejną próbę</AddButton>
        <NumericField label="Szacowana waga złota do wykonania zlecenia" name="estimatedGoldMass" unit="g" value={value.estimatedMass ?? ""} error={errors["gold.estimatedMass"]} onChange={event => onChange({ estimatedMass: event.target.value })} />
        {value.settlementVersion ? <CustomerGoldSummary gold={value} compact /> : <button type="button" className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm" onClick={() => onChange({ settlementVersion: "fine-au-v1" })}>Włącz przeliczanie prób i ubytku</button>}
      </div>}
      {value.source !== "customer" && <div className="grid gap-5 sm:grid-cols-2">
        {value.source === "mixed" && !value.settlementVersion && <NumericField label="Masa naszego złota do doliczenia" name="ourGoldMass" unit="g" value={value.ourMass ?? ""} error={errors["gold.ourMass"]} hint="Podaj ustaloną masę, którą dokładasz. Koszt obliczymy automatycznie." onChange={event => onChange({ ourMass: event.target.value })} />}
        <NumericField label={compact ? "Cena netto za gram" : "Cena zakupu złota za gram"} name="goldPurchasePrice" unit="PLN" value={value.purchasePerGram} error={errors["gold.purchasePerGram"]} onChange={event => onChange({ purchasePerGram: event.target.value })} />
      </div>}
      <dl className="rounded-xl border border-line bg-gold-soft p-4">
        <dt className="text-sm text-muted">Koszt złota netto</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(totals?.gold.purchaseCost)}</dd>
      </dl>
      {value.source === "mixed" && value.settlementVersion && <p className="text-xs text-muted">Koszt uwzględnia dokładny niedobór przed zaokrągleniem masy do 0,001 g.</p>}
    </FormSection>
  );
}
