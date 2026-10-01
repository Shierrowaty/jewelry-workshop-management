import { formatMoney } from "../calculations";

export function StonePrices({ net }: { net: number | undefined }) {
  const vat = net === undefined ? undefined : Math.round(net * 23 / 100);
  return <dl className="grid gap-3 rounded-lg bg-gold-soft p-4 sm:grid-cols-3">{([
    ["Cena netto kamienia", net], ["VAT 23%", vat], ["Cena brutto kamienia", net === undefined || vat === undefined ? undefined : net + vat],
  ] as const).map(([label, amount]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{formatMoney(amount)}</dd></div>)}</dl>;
}
