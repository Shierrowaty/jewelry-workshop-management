"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { calculateQuote } from "./calculations";
import { otherCostSuggestions } from "./catalog";
import { createEmptyQuote, getQuoteDate } from "./defaults";
import { exampleStoneCatalog } from "./stone-catalog";
import { changePricing, priceInput, convertToNetCostPricing } from "./pricing-draft";
import { FormSection } from "./components/form-section";
import { NumericField } from "./components/fields";
import type { ProductCatalog, StoneCatalog, QuoteDraft } from "./types";
import { CostLinesSection } from "./components/cost-lines-section";
import { CustomerSection } from "./components/customer-section";
import { GoldSection } from "./components/gold-section";
import { ProductSection } from "./components/product-section";
import { QuoteSummary } from "./components/quote-summary";
import { StonesSection } from "./components/stones-section";
import { getQuoteRepository } from "./data/quote-repository";
import { localDataError, requestPersistentStorage } from "./data/storage";
import type { SavedQuote } from "./data/types";
import { draftFromQuote } from "./data/snapshot";
import { useUnsavedChanges } from "./use-unsaved-changes";

type QuoteFormProps = { catalog: ProductCatalog; stoneCatalog?: StoneCatalog; conflict?: boolean; onReload?: () => void } & (
  { initialDate: string; initialQuote?: never; draftSeed?: QuoteDraft } | { initialDate?: never; initialQuote: SavedQuote; draftSeed?: never }
);

export function QuoteForm({ catalog, stoneCatalog = exampleStoneCatalog, initialDate, initialQuote, draftSeed, conflict = false, onReload }: QuoteFormProps) {
  const [initialDraft] = useState(() => initialQuote ? draftFromQuote(initialQuote) : draftSeed ? structuredClone(draftSeed) : createEmptyQuote(initialDate));
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const router = useRouter();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const allowSavedNavigation = useUnsavedChanges(Boolean(initialQuote || draftSeed) && dirty && !savedQuoteId);
  // Opening an old record renders its saved totals; calculate only after an intentional edit.
  const calculation = initialQuote && !dirty ? { errors: {}, totals: initialQuote.snapshot.totals } : calculateQuote(draft);
  const legacy = !draft.pricing;
  const saveLabel = initialQuote ? "Zapisz zmiany" : "Zapisz wycenę";

  async function saveQuote() {
    if (saveInFlight.current || conflict || (initialQuote && !dirty)) return;
    if (!draft.customer.name.trim() && !draft.customer.nickname?.trim()) {
      setSaveError("Podaj imię i nazwisko lub pseudonim klienta.");
      return;
    }
    if (legacy) return;
    if (!calculation.totals) {
      setSaveError("Popraw zaznaczone pola przed zapisaniem wyceny.");
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    void requestPersistentStorage();
    let id: string;
    try {
      const repository = getQuoteRepository();
      const quote = initialQuote
        ? await repository.updateQuote(initialQuote.id, initialQuote.revision, draft, catalog)
        : await repository.create(draft, catalog);
      id = quote.id;
    } catch (error) {
      setSaveError(localDataError(error));
      saveInFlight.current = false;
      setSaving(false);
      return;
    }
    // Confirm the local commit even if loading the details route is slow/unavailable.
    setSavedQuoteId(id);
    setSaving(false);
    allowSavedNavigation();
    router.push(`/realizacje/${id}`);
  }

  return (
    <section aria-labelledby="page-title">
      {initialQuote && <Link href={`/realizacje/${initialQuote.id}`} className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-ink"><ArrowLeft size={17} aria-hidden="true" />Wróć do szczegółów</Link>}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true" />
          <h1 id="page-title" className="font-display text-4xl leading-tight font-medium tracking-tight text-ink sm:text-5xl">{initialQuote ? "Edytuj realizację" : "Nowa wycena"}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">Wpisuj rzeczywiste koszty netto oraz cenę brutto lub kwotę, którą chcesz czysto zarobić. Podsumowanie przeliczy się na bieżąco.</p>
        </div>
        <span className="mt-4 rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-medium text-muted">{savedQuoteId ? "Zapisana lokalnie" : initialQuote ? dirty ? "Niezapisane zmiany" : "Dane zapisanej realizacji" : "Wersja robocza · jeszcze niezapisana"}</span>
      </div>

      {draftSeed && <p className="mb-6 rounded-xl border border-gold/20 bg-gold-soft p-4 text-sm">Szkic z kalkulatora. Finanse, złoto i kamienie zostały przeniesione. Uzupełnij klienta i dane produktu, a następnie zapisz wycenę.</p>}
      {initialQuote && <p className="mb-6 rounded-xl border border-gold/20 bg-gold-soft p-4 text-sm leading-6 text-ink">Formularz zawiera dane i ceny z zapisanej wyceny. Zmienione kwoty przeliczą się na bieżąco; zastąpisz zapisane dane dopiero po wybraniu „Zapisz zmiany”.{initialQuote.completedAt && " Ta realizacja jest zakończona. Edycja nie przywraca jej do aktywnych."}</p>}
      {conflict && !savedQuoteId && <div role="alert" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <p>W bazie jest nowsza wersja realizacji. Twoje wpisane dane pozostały w formularzu, ale zapis jest zablokowany, aby nie nadpisać nowszych zmian.</p>
        <button type="button" onClick={onReload} className="mt-3 min-h-11 rounded-lg border border-amber-300 px-4 font-semibold hover:bg-amber-100">Wczytaj aktualne dane</button>
      </div>}

      {legacy && <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">
        <p>To wycena zapisana według wcześniejszej logiki. Jej cena i dane pozostają bez zmian. Aby edytować w nowym formularzu, świadomie przelicz ją z VAT 23% i szacowanym podatkiem 12%. Zachowamy cenę brutto, a dawnych narzutów i robocizny nie zaliczymy do kosztów.</p>
        <button type="button" className="mt-3 min-h-11 rounded-lg border border-amber-300 px-4 font-semibold" onClick={() => { if (calculation.totals) setDraft(convertToNetCostPricing(draft, calculation.totals)); }}>Przelicz według nowej logiki</button>
      </div>}
      <form onSubmit={(event) => { event.preventDefault(); void saveQuote(); }} noValidate aria-busy={saving}>
        <fieldset disabled={legacy || saving || savedQuoteId !== null} className="min-w-0">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-6">
            <CustomerSection enteredDate={initialQuote ? getQuoteDate(new Date(initialQuote.createdAt)) : initialDate} value={draft.customer} onChange={(patch) => setDraft((current) => ({ ...current, customer: { ...current.customer, ...patch } }))} />
            <ProductSection value={{ ...draft.product, weight: draft.product.weight ?? draft.gold.mass, goldColor: draft.product.goldColor ?? draft.gold.color }} catalog={catalog} errors={calculation.errors} onChange={(patch) => setDraft((current) => ({ ...current, product: { ...current.product, ...patch } }))} />
            <GoldSection value={draft.gold} productWeight={draft.product.weight ?? draft.gold.mass} calculation={calculation} onChange={(patch) => setDraft((current) => ({ ...current, gold: { ...current.gold, ...patch } }))} />
            <StonesSection items={draft.stones} catalog={stoneCatalog} calculation={calculation} onChange={(stones) => setDraft((current) => ({ ...current, stones }))} />
            <FormSection number="05" title="Robocizna / własny zarobek" description="To kwota dla Ciebie po kosztach i szacowanym podatku. Nie doliczamy własnej pracy do kosztów netto.">
              <NumericField label="Chcę czysto zarobić" name="desiredCleanProfit" unit="PLN" value={draft.pricing?.basis === "cleanProfit" ? draft.pricing.desiredCleanProfit : priceInput(calculation.totals?.cleanProfit)} error={calculation.errors["pricing.desiredCleanProfit"]} hint="Zmiana tej kwoty przelicza cenę brutto dla klienta." onChange={event => setDraft(current => changePricing(current, "cleanProfit", event.target.value))} />
              {legacy && draft.labor.length > 0 && <p className="text-sm text-muted">Dawne pozycje robocizny pozostają w historycznym snapshotcie. Nowy formularz określa Twój zarobek jedną kwotą.</p>}
            </FormSection>
            <CostLinesSection number="06" title="Inne koszty" description="Koszty zewnętrzne doliczane do ceny bez narzutu, np. wysyłka, pudełko, cechowanie lub podwykonawca." group="otherCosts" items={draft.otherCosts} suggestions={otherCostSuggestions} errors={calculation.errors} onChange={(otherCosts) => setDraft((current) => ({ ...current, otherCosts }))} />
          </div>
          <QuoteSummary calculation={calculation} draft={draft} catalog={catalog} onGrossChange={value => setDraft(current => changePricing(current, "gross", value))} />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5">
          <p className="max-w-xl text-sm leading-6 text-muted">{initialQuote ? "Zapis aktualizuje tę realizację lokalnie. Jej identyfikator i data utworzenia pozostaną bez zmian." : "Zapisz wycenę przed opuszczeniem formularza. Dane i ceny zostaną zachowane lokalnie w tej przeglądarce, na tym urządzeniu."}</p>
          <button type="submit" disabled={conflict || Boolean(initialQuote && !dirty)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sidebar px-5 py-3 text-sm font-semibold text-sidebar-text transition-colors hover:bg-sidebar-active disabled:cursor-not-allowed disabled:opacity-65">
            <Save size={18} aria-hidden="true" />{savedQuoteId ? "Zapisana lokalnie" : saving ? "Zapisywanie lokalnie…" : saveLabel}
          </button>
        </div>
        </fieldset>
        {savedQuoteId && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">{initialQuote ? "Zmiany zostały zapisane lokalnie." : "Wycena została zapisana lokalnie."} <Link href={`/realizacje/${savedQuoteId}`} className="font-semibold underline underline-offset-4">Otwórz zapisaną wycenę</Link>.</p>}
        {saveError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{initialQuote ? "Zmiany nie zostały zapisane." : "Wycena nie została zapisana."} {saveError}</p>}
      </form>
    </section>
  );
}
