import type { CostLineDraft, QuoteErrors } from "../types";
import { NumericField, TextField } from "./fields";
import { AddButton, FormSection, RemoveButton } from "./form-section";

type Props = {
  number: string;
  title: string;
  description: string;
  group: "labor" | "otherCosts";
  items: CostLineDraft[];
  errors: QuoteErrors;
  suggestions?: string[];
  onChange: (items: CostLineDraft[]) => void;
};

export function CostLinesSection({ number, title, description, group, items, errors, suggestions, onChange }: Props) {
  const update = (id: string, patch: Partial<CostLineDraft>) => onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  return (
    <FormSection number={number} title={title} description={description}>
      {items.length === 0 && <p className="rounded-xl border border-dashed border-line bg-canvas/60 px-4 py-5 text-sm leading-6 text-muted">Brak pozycji. Dodaj je, jeśli dotyczą tej wyceny.</p>}
      {suggestions && <datalist id={`${group}-suggestions`}>{suggestions.map((name) => <option key={name} value={name} />)}</datalist>}
      {items.map((item, index) => (
        <fieldset key={item.id} className="min-w-0 rounded-xl border border-line bg-canvas/40 p-4">
          <legend className="px-1 text-sm font-semibold">Pozycja {index + 1}</legend>
          <div className="mb-2 flex justify-end">
            <RemoveButton label={`Usuń pozycję ${index + 1}: ${title.toLowerCase()}`} onClick={() => onChange(items.filter((line) => line.id !== item.id))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
            <TextField label="Nazwa pozycji" name={`${group}-${item.id}-name`} list={suggestions ? `${group}-suggestions` : undefined} placeholder={group === "labor" ? "Np. wykonanie, grawer" : "Np. wysyłka, pudełko"} value={item.name} onChange={(event) => update(item.id, { name: event.target.value })} />
            <NumericField label="Kwota netto" name={`${group}-${item.id}-amount`} unit="PLN" value={item.amount} error={errors[`${group}.${item.id}.amount`]} onChange={(event) => update(item.id, { amount: event.target.value })} />
          </div>
        </fieldset>
      ))}
      <AddButton onClick={() => onChange([...items, { id: crypto.randomUUID(), name: "", amount: "" }])}>Dodaj pozycję</AddButton>
    </FormSection>
  );
}
