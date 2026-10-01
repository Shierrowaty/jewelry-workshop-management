import type { GoldDraft, QuoteCalculation, QuoteDraft, QuoteErrors, StoneTotals } from "./types";

const ZERO = BigInt(0);
const THOUSAND = BigInt(1000);
const VAT_SCALE = BigInt(10000);
const MAX_VALUE = BigInt("1000000000000");

/** Accept a Polish comma or a dot; blank numeric draft fields represent zero. */
export function parseDecimal(raw: string, precision = 2): bigint | null {
  const value = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (value === "") return ZERO;
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) return null;
  const [whole = "", fraction = ""] = value.replace(",", ".").split(".");
  if (fraction.length > precision || whole.length > 13) return null;
  const scale = BigInt(10) ** BigInt(precision);
  const result = BigInt(whole || "0") * scale + BigInt(fraction.padEnd(precision, "0") || "0");
  return result <= MAX_VALUE ? result : null;
}

/** Round non-negative rational values half-up, without binary float arithmetic. */
function roundRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

export function calculateQuote(draft: QuoteDraft): QuoteCalculation {
  if (draft.pricing) return calculateNetCostQuote(draft);
  const errors: QuoteErrors = {};
  const read = (key: string, raw: string, precision = 2): bigint => {
    const value = parseDecimal(raw, precision);
    if (value === null) {
      errors[key] = precision === 0
        ? "Wpisz nieujemną liczbę całkowitą w dopuszczalnym zakresie."
        : `Wpisz nieujemną liczbę (do ${precision} miejsc po przecinku) w dopuszczalnym zakresie.`;
    }
    return value ?? ZERO;
  };

  const mass = read("gold.mass", draft.gold.mass, 3);
  const customerMass = draft.gold.source === "mixed"
    ? read("gold.customerMass", draft.gold.customerMass, 3)
    : draft.gold.source === "customer" ? mass : ZERO;
  if (customerMass > mass) errors["gold.customerMass"] = "Masa złota klienta nie może przekraczać potrzebnej masy.";

  const usesOurGold = draft.gold.source !== "customer";
  const purchasePerGram = usesOurGold ? read("gold.purchasePerGram", draft.gold.purchasePerGram) : ZERO;
  const markupPerGram = usesOurGold ? read("gold.markupPerGram", draft.gold.markupPerGram) : ZERO;
  const ourMass = mass >= customerMass ? mass - customerMass : ZERO;
  const customerPricePerGram = purchasePerGram + markupPerGram;
  const goldCost = roundRatio(ourMass * purchasePerGram, THOUSAND);
  const goldProfit = roundRatio(ourMass * markupPerGram, THOUSAND);
  // Round cost and planned earnings separately so the displayed components add up.
  const goldCharge = goldCost + goldProfit;

  const stones: Record<string, StoneTotals> = {};
  let stoneCost = ZERO;
  let stoneProfit = ZERO;
  for (const stone of draft.stones) {
    const quantity = read(`stones.${stone.id}.quantity`, stone.quantity, 0);
    if (quantity < BigInt(1)) errors[`stones.${stone.id}.quantity`] = "Ilość musi wynosić co najmniej 1.";
    const costPerUnit = stone.customerOwned ? ZERO : read(`stones.${stone.id}.purchasePrice`, stone.purchasePrice);
    const profitPerUnit = stone.customerOwned ? ZERO : read(`stones.${stone.id}.plannedProfit`, stone.plannedProfit ?? "");
    const totalCost = quantity * costPerUnit;
    const totalProfit = quantity * profitPerUnit;
    stoneCost += totalCost;
    stoneProfit += totalProfit;
    stones[stone.id] = {
      costPerUnit: Number(costPerUnit),
      plannedProfitPerUnit: Number(profitPerUnit),
      valuePerUnit: Number(costPerUnit + profitPerUnit),
      totalCost: Number(totalCost),
      totalProfit: Number(totalProfit),
      totalValue: Number(totalCost + totalProfit),
    };
  }

  const labor = draft.labor.reduce((sum, line) => sum + read(`labor.${line.id}.amount`, line.amount), ZERO);
  const externalCost = draft.otherCosts.reduce((sum, line) => sum + read(`otherCosts.${line.id}.amount`, line.amount), ZERO);
  const vatRate = read("vatRate", draft.vatRate);
  if (!draft.vatRate.trim() || vatRate > VAT_SCALE) errors.vatRate = "Podaj stawkę VAT od 0 do 100%.";

  const materialCost = goldCost + stoneCost;
  const totalCost = materialCost + externalCost;
  const plannedProfit = goldProfit + stoneProfit + labor;
  const calculatedNet = totalCost + plannedProfit;
  const calculatedGross = calculatedNet + roundRatio(calculatedNet * vatRate, VAT_SCALE);
  const manualPrice = draft.agreedGross.trim() !== "";
  const gross = manualPrice ? read("agreedGross", draft.agreedGross) : calculatedGross;
  const net = manualPrice ? roundRatio(gross * VAT_SCALE, VAT_SCALE + vatRate) : calculatedNet;
  const vat = gross - net;
  const profit = net - totalCost;

  const amounts = [mass, ourMass, customerPricePerGram, goldCost, goldProfit, goldCharge, stoneCost, stoneProfit,
    labor, externalCost, materialCost, totalCost, plannedProfit, calculatedNet, calculatedGross, net, vat, gross, profit];
  if (amounts.some((amount) => amount > MAX_VALUE || amount < -MAX_VALUE)) {
    errors.summary = "Wartości przekraczają zakres kalkulatora. Zmniejsz kwoty lub ilości.";
  }
  if (Object.keys(errors).length > 0) return { errors, totals: null };

  return {
    errors,
    totals: {
      gold: {
        ourMassMilligrams: Number(ourMass),
        customerPricePerGram: Number(customerPricePerGram),
        purchaseCost: Number(goldCost),
        customerCharge: Number(goldCharge),
        profit: Number(goldProfit),
      },
      stones,
      stoneCost: Number(stoneCost),
      materialCost: Number(materialCost),
      externalCost: Number(externalCost),
      totalCost: Number(totalCost),
      stoneProfit: Number(stoneProfit),
      labor: Number(labor),
      plannedProfit: Number(plannedProfit),
      plannedMarginPercent: calculatedNet > ZERO ? Number(plannedProfit) / Number(calculatedNet) * 100 : null,
      calculatedNet: Number(calculatedNet),
      calculatedGross: Number(calculatedGross),
      priceAdjustment: Number(net - calculatedNet),
      net: Number(net),
      vat: Number(vat),
      gross: Number(gross),
      profit: Number(profit),
      marginPercent: net > ZERO ? Number(profit) / Number(net) * 100 : null,
      manualPrice,
    },
  };
}

/** Current pricing: actual net costs, fixed 23% VAT and estimated 12% profit tax. */
function calculateNetCostQuote(draft: QuoteDraft): QuoteCalculation {
  const errors: QuoteErrors = {};
  const read = (key: string, raw: string, precision = 2) => {
    const result = parseDecimal(raw, precision);
    if (result === null) errors[key] = `Wpisz nieujemną liczbę, maksymalnie ${precision} miejsc po przecinku.`;
    return result ?? ZERO;
  };
  const mass = read("product.weight", draft.product.weight ?? draft.gold.mass, 3);
  const customerGoldMass = draft.gold.source === "ours" ? ZERO : (draft.gold.customerLots ?? []).reduce((sum, lot) => {
    if (!lot.fineness.trim()) errors[`gold.lots.${lot.id}.fineness`] = "Podaj próbę złota.";
    return sum + read(`gold.lots.${lot.id}.mass`, lot.mass, 3);
  }, ZERO);
  if (draft.gold.source !== "ours") read("gold.estimatedMass", draft.gold.estimatedMass ?? "", 3);
  const settlement = draft.gold.settlementVersion && draft.gold.source !== "ours" ? calculateGoldSettlement(draft.gold) : null;
  if (settlement) Object.assign(errors, settlement.errors);
  // Historical records retain their explicitly entered own-gold mass.
  const ourMass = draft.gold.source === "customer" ? ZERO : draft.gold.source === "mixed"
    ? settlement?.shortfall ? roundRatio(settlement.shortfall.numerator, settlement.shortfall.denominator) : read("gold.ourMass", draft.gold.ourMass ?? "", 3) : mass;
  if (!draft.gold.settlementVersion && draft.gold.source === "mixed" && !draft.gold.ourMass?.trim()) errors["gold.ourMass"] = "Podaj masę naszego złota do doliczenia (lub 0) albo włącz przeliczanie prób i ubytku.";
  const price = draft.gold.source === "customer" ? ZERO : read("gold.purchasePerGram", draft.gold.purchasePerGram);
  const goldCost = draft.gold.source === "mixed" && settlement?.shortfall
    ? roundRatio(settlement.shortfall.numerator * price, settlement.shortfall.denominator * THOUSAND)
    : roundRatio(ourMass * price, THOUSAND);
  let stoneCost = ZERO;
  const stones: Record<string, StoneTotals> = {};
  for (const stone of draft.stones) {
    const key = `stones.${stone.id}`;
    const quantity = read(`${key}.quantity`, stone.quantity, 0);
    if (quantity < BigInt(1)) errors[`${key}.quantity`] = "Ilość musi wynosić co najmniej 1.";
    const carats = read(`${key}.carats`, stone.carats ?? "", 3);
    const unitPrice = stone.customerOwned ? ZERO : read(`${key}.purchasePrice`, stone.purchasePrice);
    const cost = stone.priceBasis === "carat" ? roundRatio(carats * unitPrice, THOUSAND) : quantity * unitPrice;
    stoneCost += cost;
    stones[stone.id] = { costPerUnit: Number(unitPrice), plannedProfitPerUnit: 0, valuePerUnit: Number(unitPrice), totalCost: Number(cost), totalProfit: 0, totalValue: Number(cost) };
  }
  const labor = draft.labor.reduce((sum, line) => sum + read(`labor.${line.id}.amount`, line.amount), ZERO);
  const externalCost = draft.otherCosts.reduce((sum, line) => sum + read(`otherCosts.${line.id}.amount`, line.amount), ZERO);
  const materialCost = goldCost + stoneCost;
  const totalCost = materialCost + externalCost;
  const grossDriven = draft.pricing?.basis === "gross";
  const desired = grossDriven ? ZERO : read("pricing.desiredCleanProfit", draft.pricing?.desiredCleanProfit ?? "");
  const targetProfit = roundRatio(desired * BigInt(100), BigInt(88));
  const gross = grossDriven ? read("agreedGross", draft.agreedGross) : roundRatio((totalCost + targetProfit) * BigInt(123), BigInt(100));
  // Always reconcile against the actual payable gross amount after cent rounding.
  const net = roundRatio(gross * BigInt(100), BigInt(123));
  const profit = net - totalCost;
  const tax = profit > ZERO ? roundRatio(profit * BigInt(12), BigInt(100)) : ZERO;
  const cleanProfit = profit - tax;
  const vat = gross - net;
  if ([mass, customerGoldMass, ourMass, price, goldCost, stoneCost, labor, externalCost, totalCost, desired, targetProfit, gross, net, profit, tax, cleanProfit].some(v => v > MAX_VALUE || v < -MAX_VALUE)) {
    errors.summary = "Wartości przekraczają zakres kalkulatora. Zmniejsz kwoty lub ilości.";
  }
  if (Object.keys(errors).length) return { errors, totals: null };
  return { errors, totals: {
    gold: { ourMassMilligrams: Number(ourMass), customerPricePerGram: Number(price), purchaseCost: Number(goldCost), customerCharge: Number(goldCost), profit: 0 },
    stones, stoneCost: Number(stoneCost), materialCost: Number(materialCost), externalCost: Number(externalCost), totalCost: Number(totalCost),
    stoneProfit: 0, labor: Number(labor), plannedProfit: Number(profit), plannedMarginPercent: net > ZERO ? Number(profit) / Number(net) * 100 : null,
    calculatedNet: Number(net), calculatedGross: Number(gross), priceAdjustment: 0, net: Number(net), vat: Number(vat), gross: Number(gross), profit: Number(profit),
    marginPercent: net > ZERO ? Number(profit) / Number(net) * 100 : null, manualPrice: grossDriven,
    estimatedTax: Number(tax), cleanProfit: Number(cleanProfit), customerGoldMilligrams: Number(customerGoldMass),
  } };
}

const currency = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", currencyDisplay: "code" });
export function formatMoney(grosz: number | null | undefined): string {
  return grosz == null ? "—" : currency.format(grosz / 100);
}

export function formatDecimal(value: number, precision = 2): string {
  return new Intl.NumberFormat("pl-PL", { minimumFractionDigits: precision, maximumFractionDigits: precision }).format(value);
}

/** Keep Au, loss and shortfall rational; only financial amounts are rounded to grosz. */
export function calculateGoldSettlement(gold: GoldDraft) {
  const errors: QuoteErrors = {};
  const read = (key: string, raw: string, precision: number) => {
    const value = parseDecimal(raw, precision);
    if (value === null) errors[key] = `Wpisz nieujemną liczbę, maksymalnie ${precision} miejsc po przecinku.`;
    return value ?? ZERO;
  };
  const fineness = (key: string, raw: string) => {
    const value = read(key, raw, 0);
    if (value <= ZERO || value > THOUSAND) errors[key] = "Podaj próbę od 1 do 1000.";
    return value;
  };
  const target = fineness("gold.fineness", gold.fineness);
  let physical = ZERO;
  let pureNumerator = ZERO;
  for (const lot of gold.customerLots ?? []) {
    const mass = read(`gold.lots.${lot.id}.mass`, lot.mass, 3);
    physical += mass;
    pureNumerator += mass * fineness(`gold.lots.${lot.id}.fineness`, lot.fineness);
  }
  const estimated = read("gold.estimatedMass", gold.estimatedMass ?? "", 3);
  const lossPercent = estimated <= BigInt(3000) ? 15 : 10;
  if (Object.keys(errors).length) return { errors, value: null };
  const hundred = BigInt(100);
  const lossNumerator = estimated * BigInt(lossPercent);
  const requiredNumerator = estimated * hundred + lossNumerator;
  const denominator = target * hundred;
  const balanceNumerator = pureNumerator * hundred - requiredNumerator * target;
  if (physical > MAX_VALUE || pureNumerator > MAX_VALUE * target || requiredNumerator > MAX_VALUE * hundred) {
    errors.summary = "Wartości przekraczają zakres kalkulatora. Zmniejsz masy.";
    return { errors, value: null };
  }
  return { errors, shortfall: { numerator: balanceNumerator < ZERO ? -balanceNumerator : ZERO, denominator }, value: {
    physicalMilligrams: Number(physical), pureMilligrams: Number(pureNumerator) / 1000,
    averageFineness: physical > ZERO ? Number(pureNumerator) / Number(physical) : null,
    targetFineness: Number(target), convertedMilligrams: Number(pureNumerator) / Number(target),
    estimatedMilligrams: Number(estimated), lossPercent, lossMilligrams: Number(lossNumerator) / 100,
    requiredMilligrams: Number(requiredNumerator) / 100, balanceMilligrams: Number(balanceNumerator) / Number(denominator),
  } };
}
