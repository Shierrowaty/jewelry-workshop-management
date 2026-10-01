import { Gem } from "lucide-react";
import { StonePrices } from "./stone-prices";
import type { QuoteCalculation, StoneCatalog, StoneDraft } from "../types";
import { CheckboxField, NumericField, SelectField, TextField } from "./fields";
import { AddButton, FormSection, RemoveButton } from "./form-section";

export function StonesSection({ items, catalog, calculation, onChange, compact = false }: { compact?: boolean; items: StoneDraft[]; catalog: StoneCatalog; calculation: QuoteCalculation; onChange: (items: StoneDraft[]) => void }) {
  const { errors, totals } = calculation;
  const update = (id: string, patch: Partial<StoneDraft>) => onChange(items.map(item => item.id === id ? { ...item, ...patch } : item));
  return (
    <FormSection embedded={compact} number="04" title="Kamienie" description="Rzeczywiste koszty netto. Wybierz cenę za karat lub za sztukę.">
      {items.length === 0 && <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-canvas/60 px-4 py-5 text-sm text-muted"><Gem size={21} className="text-gold" aria-hidden="true" />Dodaj kamienie, które będą wykorzystane w realizacji.</div>}
      {items.map((item, index) => (
        <fieldset key={item.id} className="min-w-0 rounded-xl border border-line bg-canvas/40 p-4">
          <legend className="px-1 text-sm font-semibold">Kamień {index + 1}</legend>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <CheckboxField label="Kamień klienta" name={`stone-${item.id}-owned`} checked={item.customerOwned} onChange={event => update(item.id, { customerOwned: event.target.checked })} />
            <RemoveButton label={`Usuń kamień ${index + 1}`} onClick={() => onChange(items.filter(stone => stone.id !== item.id))} />
          </div>
          <div className="space-y-4">
            <SelectField label="Rodzaj / nazwa kamienia" name={`stone-${item.id}-name`} value={item.catalogId ?? (item.name ? "historical" : "")} onChange={event => { const selected = catalog.find(row => row.id === event.target.value); if (selected) update(item.id, { catalogId: selected.id, name: selected.name }); }}>
              <option value="">Wybierz kamień</option>
              {item.name && <option value={item.catalogId ?? "historical"}>{item.name}</option>}
              {catalog.filter(row => row.id !== item.catalogId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </SelectField>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumericField label="Ilość (szt.)" name={`stone-${item.id}-quantity`} unit="szt." inputMode="numeric" value={item.quantity} error={errors[`stones.${item.id}.quantity`]} onChange={event => update(item.id, { quantity: event.target.value })} />
              <NumericField label="Waga (karaty)" hint="Łączna waga tej pozycji. Nie mnożymy jej ponownie przez ilość." name={`stone-${item.id}-carats`} unit="ct" value={item.carats ?? ""} error={errors[`stones.${item.id}.carats`]} onChange={event => update(item.id, { carats: event.target.value })} />
              <TextField label="Kształt" name={`stone-${item.id}-shape`} value={item.shape ?? ""} onChange={event => update(item.id, { shape: event.target.value })} />
              <TextField label="Wymiary" name={`stone-${item.id}-dimensions`} placeholder="Np. 5 × 4 mm" value={item.dimensions ?? ""} onChange={event => update(item.id, { dimensions: event.target.value })} />
            </div>
            <SelectField label="Sposób naliczania ceny" name={`stone-${item.id}-basis`} value={item.priceBasis ?? "piece"} onChange={event => update(item.id, { priceBasis: event.target.value as "carat" | "piece" })}>
              <option value="piece">Cena za sztukę</option><option value="carat">Cena za karat</option>
            </SelectField>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumericField label={item.priceBasis === "carat" ? "Cena netto za karat" : "Cena netto za sztukę"} name={`stone-${item.id}-purchase`} unit="PLN" value={item.customerOwned ? "0" : item.purchasePrice} disabled={item.customerOwned} error={errors[`stones.${item.id}.purchasePrice`]} onChange={event => update(item.id, { purchasePrice: event.target.value })} />
              <StonePrices net={totals?.stones[item.id]?.totalValue} />
            </div>
            {item.customerOwned && <p className="text-xs text-muted">Kamień klienta nie zwiększa kosztu materiałów.</p>}
          </div>
        </fieldset>
      ))}
      <AddButton onClick={() => onChange([...items, { id: crypto.randomUUID(), name: "", quantity: "1", carats: "", shape: "", dimensions: "", priceBasis: "piece", purchasePrice: "", plannedProfit: "", customerOwned: false }])}>Dodaj kamień</AddButton>
    </FormSection>
  );
}
