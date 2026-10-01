import { isHistoricalQuote } from "../historical-quote";

export function HistoricalQuoteBadge({ date, enteredDate }: { date: string; enteredDate: string }) {
  if (!isHistoricalQuote(date, enteredDate)) return null;
  return <span className="inline-block rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950">Wycena historyczna</span>;
}
