"use client";

import { CalculatorEditor } from "@/features/calculator/calculator-editor";
import { SavedCalculations, EditCalculation } from "@/features/calculator/saved-calculations";
import { QuoteFromCalculator } from "@/features/calculator/quote-from-calculator";
import { KnowledgeBase } from "@/features/knowledge/knowledge-base";
import { Dashboard } from "@/components/dashboard";
import { SectionPlaceholder } from "@/components/section-placeholder";
import { sections } from "@/config/navigation";
import { exampleCatalog } from "@/features/quotes/catalog";
import { getQuoteDate } from "@/features/quotes/defaults";
import { EditSavedQuote } from "@/features/quotes/edit-saved-quote";
import { QuoteForm } from "@/features/quotes/quote-form";
import { SavedQuoteDetails } from "@/features/quotes/saved-quote-details";
import { SavedQuotesList } from "@/features/quotes/saved-quotes-list";
import { LoginScreen } from "@/features/sync/login-screen";
import { useAppPathname } from "./use-app-pathname";

// Only UI code is bundled here. No record, ID, session or cloud response is
// serialized into the static shell. Existing components read their own Dexie data.
export function OfflineShell() {
  const path = useAppPathname();
  if (!path) return <p role="status">Uruchamianie lokalnej aplikacji…</p>;
  if (path === "/" || path === "/offline") return <Dashboard />;
  if (path === "/realizacje") return <SavedQuotesList />;
  if (path === "/nowa-wycena") return <QuoteForm catalog={exampleCatalog} initialDate={getQuoteDate(new Date())} />;
  if (path === "/kalkulator") return <CalculatorEditor initialDate={getQuoteDate(new Date())} />;
  if (path === "/kalkulator/zapisane") return <SavedCalculations />;
  const calculation = /^\/kalkulator\/([^/]+)$/.exec(path);
  if (calculation) return <EditCalculation key={calculation[1]} id={calculation[1]} />;
  const transfer = /^\/nowa-wycena\/z-kalkulatora\/([^/]+)$/.exec(path);
  if (transfer) return <QuoteFromCalculator key={transfer[1]} id={transfer[1]} />;
  const quote = /^\/realizacje\/([^/]+)(\/edytuj)?$/.exec(path);
  if (quote) return quote[2]
    ? <EditSavedQuote key={quote[1]} id={quote[1]} catalog={exampleCatalog} />
    : <SavedQuoteDetails key={quote[1]} id={quote[1]} />;
  if (path === sections.settings.href) return <KnowledgeBase />;
  if (path === "/logowanie") return <LoginScreen />;
  const section = Object.values(sections).find(item => item.href === path);
  if (section) return <SectionPlaceholder section={section} />;
  return <p>Nie znaleziono strony. Wróć do Realizacji w menu.</p>;
}
