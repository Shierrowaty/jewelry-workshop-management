import { useRef, useState } from "react";
import { NumericField, SelectField, TextareaField, TextField } from "../quotes/components/fields";
import { StonePrices } from "../quotes/components/stone-prices";
import { requestPersistentStorage } from "../quotes/data/storage";
import { useUnsavedChanges } from "../quotes/use-unsaved-changes";
import { catalogGroups, departmentName, entryGroupId, groupAssignment } from "./catalog";
import { calculateKnowledge } from "./calculations";
import { getKnowledgeRepository } from "./repository";
import { emptyKnowledgeDraft, type KnowledgeCategory, type KnowledgeDraft, type KnowledgeEntry } from "./types";
import { knowledgeError } from "./use-knowledge";

export function EntryEditor({ initial, entry, categories, entries, onClose, onSaved }: { initial: KnowledgeDraft; entry?: KnowledgeEntry; categories: KnowledgeCategory[]; entries: KnowledgeEntry[]; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const inFlight = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const allowNavigation = useUnsavedChanges(dirty, "Masz niezapisane zmiany w Bazie wiedzy. Wyjść bez zapisu?");
  const groups = catalogGroups(categories, draft.kind, entries);
  const result = calculateKnowledge({ ...draft, categoryId: draft.categoryId || "department-on-save" });
  const update = (patch: Partial<KnowledgeDraft>) => setDraft(current => ({ ...current, ...patch }));
  const text = (key: keyof KnowledgeDraft, label: string, options: { numeric?: boolean; unit?: string; hint?: string } = {}) => {
    const Field = options.numeric ? NumericField : TextField;
    return <Field key={key} label={label} unit={options.unit} hint={options.hint} value={draft[key]} error={submitted ? result.errors[key] : undefined} onChange={event => update({ [key]: event.target.value })} />;
  };
  async function save() {
    if (inFlight.current) return;
    setSubmitted(true); setError("");
    if (Object.keys(result.errors).length) { setError("Popraw zaznaczone pola."); return; }
    inFlight.current = true; setBusy(true);
    try { await getKnowledgeRepository().saveCatalogEntry(draft, entry); void requestPersistentStorage(); allowNavigation(); onSaved(); }
    catch (error) { setError(knowledgeError(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section aria-label={entry ? "Edytuj rekord" : "Nowy rekord"} className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <h2 className="mb-5 font-display text-3xl">{entry ? "Edytuj rekord" : "Nowy rekord"}</h2>
    <form onSubmit={event => { event.preventDefault(); void save(); }} noValidate>
      <fieldset disabled={busy} className="space-y-5">
        <SelectField label="Dział" value={draft.kind} disabled={Boolean(entry)} onChange={event => setDraft({ ...emptyKnowledgeDraft(draft.entryDate, event.target.value as KnowledgeDraft["kind"]), name: draft.name, notes: draft.notes })}>
          <option value="stone">Kamienie</option><option value="product">Wyroby</option>
        </SelectField>
        <SelectField label="Grupa" hint={groups.length ? "Grupa jest opcjonalna. Możesz ją zmienić także po zapisaniu rekordu." : `W dziale „${departmentName(draft.kind)}” nie ma jeszcze grup. Dodasz je w „Zarządzaj bazą”. Ten rekord możesz zapisać bez grupy.`} value={entryGroupId(draft, categories)} onChange={event => update(groupAssignment(event.target.value, categories))}>
          <option value="">Bez grupy</option>{groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
        </SelectField>
        {text("name", draft.kind === "stone" ? "Rodzaj / nazwa kamienia" : "Nazwa produktu")}
        {draft.kind === "stone" ? <>
          {text("supplier", "Dostawca")}
          <div className="grid gap-5 sm:grid-cols-2">{text("shape", "Kształt")}{text("dimensions", "Wymiary")}{text("carats", "Waga (ct)", { numeric: true, unit: "ct" })}
            <SelectField label="Sposób ceny" value={draft.priceBasis} onChange={event => update({ priceBasis: event.target.value as "carat" | "piece" })}><option value="carat">Za karat</option><option value="piece">Za sztukę</option></SelectField>
          </div>
          {text("unitNetPrice", draft.priceBasis === "carat" ? "Cena netto za karat" : "Cena netto za sztukę", { numeric: true, unit: "PLN" })}
          <StonePrices net={result.stone?.net} />
        </> : <div className="grid gap-5 sm:grid-cols-2">
          {text("referenceWeight", "Waga referencyjna", { numeric: true, unit: "g" })}{text("fineness", "Próba złota", { numeric: true })}{text("goldColor", "Kolor złota")}
          {text("goldPricePerGram", "Cena złota za gram w momencie wpisu", { numeric: true, unit: "PLN" })}
          {text("materialCost", "Koszt materiału", { numeric: true, unit: "PLN", hint: "Wpisz koszt referencyjny dla tego wyrobu." })}
          {text("laborPrice", "Cena wykonania / robocizny", { numeric: true, unit: "PLN" })}
          {text("finishedPrice", "Cena gotowego produktu", { numeric: true, unit: "PLN" })}
        </div>}
        <TextField label="Data wpisu" type="date" value={draft.entryDate} error={submitted ? result.errors.entryDate : undefined} onChange={event => update({ entryDate: event.target.value })} />
        <TextareaField label="Uwagi" rows={3} value={draft.notes} onChange={event => update({ notes: event.target.value })} />
        <div className="flex flex-wrap gap-3">
          <button className="min-h-11 rounded-xl bg-sidebar px-5 text-sm font-semibold text-sidebar-text">{busy ? "Zapisywanie…" : "Zapisz rekord"}</button>
          <button type="button" className="min-h-11 rounded-xl border border-line px-5 text-sm" onClick={() => { if (!dirty || window.confirm("Odrzucić niezapisane zmiany rekordu?")) onClose(); }}>Anuluj</button>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </form>
  </section>;
}
