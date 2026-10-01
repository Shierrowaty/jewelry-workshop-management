import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, calculateGoldSettlement, parseDecimal, formatMoney } from "./calculations.ts";
import { createEmptyQuote as createCurrentQuote, getQuoteDate } from "./defaults.ts";

// Keep regressions for historical snapshots that have no pricing discriminator.
function createEmptyQuote(date) {
  const draft = createCurrentQuote(date);
  delete draft.pricing;
  return draft;
}

function sample() {
  const draft = createEmptyQuote("2026-09-03");
  Object.assign(draft.gold, { mass: "3,5", purchasePerGram: "200", markupPerGram: "50" });
  draft.stones = [{ id: "s1", name: "Kamień", quantity: "2", purchasePrice: "100", plannedProfit: "50", customerOwned: false }];
  draft.labor = [{ id: "l1", name: "Wykonanie", amount: "500" }];
  draft.otherCosts = [{ id: "o1", name: "Usługa zewnętrzna", amount: "50" }];
  return draft;
}

function workshopExample() {
  const draft = createEmptyQuote("2026-09-03");
  Object.assign(draft.gold, { mass: "5,5", purchasePerGram: "350", markupPerGram: "350" });
  draft.stones = [{ id: "stone", name: "Kamień", quantity: "1", purchasePrice: "200", plannedProfit: "800", customerOwned: false }];
  draft.labor = [{ id: "work", name: "Wykonanie", amount: "2000" }];
  draft.otherCosts = [{ id: "shipping", name: "Wysyłka", amount: "25" }, { id: "box", name: "Pudełko", amount: "10" }];
  return draft;
}

test("Polish decimals, decimal dots, spaces and trailing comma", () => {
  assert.equal(parseDecimal("1 234,56"), BigInt(123456));
  assert.equal(parseDecimal("1\u00a0234.56"), BigInt(123456));
  assert.equal(parseDecimal(",5"), BigInt(50));
  assert.equal(parseDecimal("12,"), BigInt(1200));
  assert.equal(parseDecimal("0,125", 3), BigInt(125));
  assert.equal(parseDecimal(""), BigInt(0));
});

test("invalid numbers are not silently coerced", () => {
  for (const value of ["-1", "1e3", "NaN", "Infinity", "1,2.3", "abc", "1,234", "99999999999999999999"]) {
    assert.equal(parseDecimal(value), null, value);
  }
});

test("blank draft has zero totals and default VAT", () => {
  const draft = createEmptyQuote("2026-09-03");
  const { totals, errors } = calculateQuote(draft);
  assert.deepEqual(errors, {});
  assert.equal(draft.vatRate, "23");
  assert.equal(totals.gross, 0);
  assert.equal(totals.marginPercent, null);
});

test("all components, quantities, VAT and profit reconcile", () => {
  const { totals, errors } = calculateQuote(sample());
  assert.deepEqual(errors, {});
  assert.deepEqual(totals.gold, { ourMassMilligrams: 3500, customerPricePerGram: 25000, purchaseCost: 70000, customerCharge: 87500, profit: 17500 });
  assert.equal(totals.materialCost, 90000);
  assert.equal(totals.externalCost, 5000);
  assert.equal(totals.stoneProfit, 10000);
  assert.equal(totals.labor, 50000);
  assert.equal(totals.net, 172500);
  assert.equal(totals.vat, 39675);
  assert.equal(totals.gross, 212175);
  assert.equal(totals.profit, 77500);
  assert.equal(totals.profit, totals.gold.profit + totals.stoneProfit + totals.labor);
});

test("customer gold excludes purchase cost and markup", () => {
  const draft = sample();
  draft.gold.source = "customer";
  draft.gold.purchasePerGram = "ignored";
  const { totals } = calculateQuote(draft);
  assert.equal(totals.gold.purchaseCost, 0);
  assert.equal(totals.gold.customerCharge, 0);
  assert.equal(totals.gross, 104550);
});

test("mixed gold charges only the workshop portion", () => {
  const draft = sample();
  Object.assign(draft.gold, { source: "mixed", customerMass: "1,5" });
  const { totals } = calculateQuote(draft);
  assert.equal(totals.gold.ourMassMilligrams, 2000);
  assert.equal(totals.gold.purchaseCost, 40000);
  assert.equal(totals.gold.profit, 10000);
  assert.equal(totals.gross, 166050);
});

test("excess customer gold blocks the calculation", () => {
  const draft = sample();
  Object.assign(draft.gold, { source: "mixed", customerMass: "4" });
  const result = calculateQuote(draft);
  assert.equal(result.totals, null);
  assert.ok(result.errors["gold.customerMass"]);
});

test("customer-owned stones ignore dormant prices", () => {
  const draft = sample();
  Object.assign(draft.stones[0], { customerOwned: true, purchasePrice: "ignored", plannedProfit: "ignored" });
  const { totals } = calculateQuote(draft);
  assert.equal(totals.stoneProfit, 0);
  assert.equal(totals.stoneCost, 0);
  assert.equal(totals.stones.s1.valuePerUnit, 0);
  assert.equal(totals.stones.s1.totalValue, 0);
  assert.equal(totals.materialCost, 70000);
  assert.equal(totals.net, 142500);
});

test("multiple rows and removal recalculate every subtotal", () => {
  const draft = sample();
  draft.stones.push({ ...draft.stones[0], id: "s2", quantity: "3", purchasePrice: "20", plannedProfit: "15" });
  draft.labor.push({ id: "l2", name: "Grawer", amount: "120,50" });
  draft.otherCosts.push({ id: "o2", name: "Dostawa", amount: "20,99" });
  const before = calculateQuote(draft).totals;
  assert.equal(before.stoneProfit, 14500);
  assert.equal(before.labor, 62050);
  assert.equal(before.externalCost, 7099);
  assert.equal(before.stones.s2.valuePerUnit, 3500);
  assert.equal(before.stones.s2.totalValue, 10500);
  draft.stones = [];
  draft.labor = [];
  draft.otherCosts = [];
  const after = calculateQuote(draft).totals;
  assert.equal(after.net, 87500);
  assert.equal(after.profit, 17500);
  assert.equal(after.plannedProfit, 17500);
  assert.deepEqual(after.stones, {});
});

test("agreed gross price changes net, VAT and real order margin", () => {
  const draft = sample();
  draft.agreedGross = "2 000,00";
  const { totals } = calculateQuote(draft);
  assert.equal(totals.calculatedGross, 212175);
  assert.equal(totals.gross, 200000);
  assert.equal(totals.net, 162602);
  assert.equal(totals.vat, 37398);
  assert.equal(totals.profit, 67602);
  assert.equal(totals.priceAdjustment, -9898);
  assert.equal(totals.plannedProfit, 77500);
  assert.equal(totals.profit, totals.plannedProfit + totals.priceAdjustment);
  draft.agreedGross = "";
  assert.equal(calculateQuote(draft).totals.gross, 212175);
});

test("zero agreed price is intentional and loss stays visible", () => {
  const draft = sample();
  draft.agreedGross = "0";
  const { totals } = calculateQuote(draft);
  assert.equal(totals.gross, 0);
  assert.equal(totals.profit, -95000);
  assert.equal(totals.marginPercent, null);
  assert.equal(totals.plannedProfit, 77500);
  assert.equal(totals.plannedMarginPercent, 77500 / 172500 * 100);
});

test("VAT supports zero and fractional rates", () => {
  const draft = sample();
  draft.vatRate = "0";
  assert.equal(calculateQuote(draft).totals.gross, 172500);
  draft.vatRate = "8,5";
  assert.equal(calculateQuote(draft).totals.vat, 14663);
  for (const rate of ["", "-1", "100,01", "abc"]) {
    draft.vatRate = rate;
    assert.equal(calculateQuote(draft).totals, null);
  }
});

test("integer grosz avoid float errors and gold rounding stays consistent", () => {
  const draft = createEmptyQuote("2026-09-03");
  Object.assign(draft.gold, { mass: "0,005", purchasePerGram: "1", markupPerGram: "1" });
  let totals = calculateQuote(draft).totals;
  assert.equal(totals.gold.purchaseCost, 1);
  assert.equal(totals.gold.customerCharge, 2);
  assert.equal(totals.gold.profit, 1);
  draft.gold.mass = "";
  draft.labor = [{ id: "a", name: "A", amount: "0,10" }, { id: "b", name: "B", amount: "0,20" }];
  totals = calculateQuote(draft).totals;
  assert.equal(totals.net, 30);
  assert.equal(totals.vat, 7);
  assert.equal(totals.gross, 37);
});

test("invalid quantities and prices prevent a misleading total", () => {
  for (const quantity of ["0", "", "-1", "1,5"]) {
    const draft = sample();
    draft.stones[0].quantity = quantity;
    assert.equal(calculateQuote(draft).totals, null);
  }
  const draft = sample();
  draft.labor[0].amount = "-500";
  assert.ok(calculateQuote(draft).errors["labor.l1.amount"]);
});

test("very large products are rejected without Infinity or unsafe rounding", () => {
  const draft = sample();
  Object.assign(draft.stones[0], { quantity: "1000000000", plannedProfit: "1000000000" });
  assert.equal(calculateQuote(draft).totals, null);
});

test("date defaults follow Warsaw including midnight and daylight saving", () => {
  assert.equal(getQuoteDate(new Date("2026-09-03T22:30:00Z")), "2026-09-04");
  assert.equal(getQuoteDate(new Date("2026-01-03T23:30:00Z")), "2026-01-04");
});

test("money is formatted with Polish decimals and explicit PLN", () => {
  assert.match(formatMoney(123456), /1\s?234,56\sPLN/);
  assert.equal(formatMoney(null), "—");
});

test("owner's example A matches every requested cost, earnings and tax amount", () => {
  const { totals, errors } = calculateQuote(workshopExample());
  assert.deepEqual(errors, {});
  assert.equal(totals.gold.purchaseCost, 192500);
  assert.equal(totals.gold.profit, 192500);
  assert.equal(totals.gold.customerCharge, 385000);
  assert.equal(totals.stoneCost, 20000);
  assert.equal(totals.stoneProfit, 80000);
  assert.equal(totals.stones.stone.valuePerUnit, 100000);
  assert.equal(totals.externalCost, 3500);
  assert.equal(totals.totalCost, 216000);
  assert.equal(totals.plannedProfit, 472500);
  assert.equal(totals.net, 688500);
  assert.equal(totals.vat, 158355);
  assert.equal(totals.gross, 846855);
  assert.equal(totals.profit, 472500);
});

test("example B puts all earnings in labor with both markup fields empty", () => {
  const draft = workshopExample();
  draft.gold.markupPerGram = "";
  draft.stones[0].plannedProfit = "";
  draft.labor[0].amount = "4725";
  const { totals, errors } = calculateQuote(draft);
  assert.deepEqual(errors, {});
  assert.equal(totals.gold.profit, 0);
  assert.equal(totals.stoneProfit, 0);
  assert.equal(totals.gold.customerCharge, 192500);
  assert.equal(totals.stones.stone.totalValue, 20000);
  assert.equal(totals.labor, 472500);
  assert.equal(totals.totalCost, 216000);
  assert.equal(totals.plannedProfit, 472500);
  assert.equal(totals.net, 688500);
  assert.equal(totals.vat, 158355);
  assert.equal(totals.gross, 846855);
});

test("mixed earnings allocations work without a separate mode", () => {
  const arrangements = [
    { gold: "350", stone: "", labor: "2800" },
    { gold: "", stone: "800", labor: "3925" },
    { gold: "100", stone: "400", labor: "3775" },
  ];
  for (const arrangement of arrangements) {
    const draft = workshopExample();
    draft.gold.markupPerGram = arrangement.gold;
    draft.stones[0].plannedProfit = arrangement.stone;
    draft.labor = [{ id: "work", name: "Wykonanie", amount: arrangement.labor }];
    const { totals } = calculateQuote(draft);
    assert.equal(totals.totalCost, 216000);
    assert.equal(totals.plannedProfit, 472500);
    assert.equal(totals.gross, 846855);
  }
});

test("empty earnings are zero and require no manually entered zero", () => {
  const draft = workshopExample();
  draft.gold.markupPerGram = " ";
  draft.stones[0].plannedProfit = "";
  draft.labor[0].amount = "";
  const { totals, errors } = calculateQuote(draft);
  assert.deepEqual(errors, {});
  assert.equal(totals.plannedProfit, 0);
  assert.equal(totals.plannedMarginPercent, 0);
  assert.equal(totals.net, 216000);
  assert.equal(totals.gross, 265680);
  const explicitZeros = structuredClone(draft);
  explicitZeros.gold.markupPerGram = "0";
  explicitZeros.stones[0].plannedProfit = "0";
  explicitZeros.labor[0].amount = "0";
  assert.deepEqual(calculateQuote(explicitZeros).totals, totals);
});

test("stone cost plus planned earnings are multiplied by quantity", () => {
  const draft = createEmptyQuote("2026-09-03");
  draft.stones = [{ id: "stone", name: "Kamień", quantity: "3", purchasePrice: "200", plannedProfit: "800", customerOwned: false }];
  const { totals } = calculateQuote(draft);
  assert.deepEqual(totals.stones.stone, { costPerUnit: 20000, plannedProfitPerUnit: 80000, valuePerUnit: 100000, totalCost: 60000, totalProfit: 240000, totalValue: 300000 });
  assert.equal(totals.totalCost, 60000);
  assert.equal(totals.plannedProfit, 240000);
  assert.equal(totals.gross, 369000);
});

test("optional stone earnings still validate non-empty invalid input", () => {
  for (const value of ["-1", "abc", "1,234", "1.2.3"]) {
    const draft = workshopExample();
    draft.stones[0].plannedProfit = value;
    const result = calculateQuote(draft);
    assert.equal(result.totals, null);
    assert.ok(result.errors["stones.stone.plannedProfit"]);
  }
  const draft = workshopExample();
  delete draft.stones[0].plannedProfit;
  assert.equal(calculateQuote(draft).totals.stoneProfit, 0);
});

test("commas and dots in earnings fields give identical results", () => {
  const comma = workshopExample();
  comma.gold.markupPerGram = "350,25";
  comma.stones[0].plannedProfit = "800,45";
  comma.labor[0].amount = "2000,50";
  const dot = structuredClone(comma);
  dot.gold.mass = "5.5";
  dot.gold.markupPerGram = "350.25";
  dot.stones[0].plannedProfit = "800.45";
  dot.labor[0].amount = "2000.50";
  assert.deepEqual(calculateQuote(dot), calculateQuote(comma));
  assert.equal(calculateQuote(comma).totals.plannedProfit, 472733);
});

test("catalog identifiers, statuses and an empty due date do not dictate pricing", () => {
  const draft = workshopExample();
  const expected = calculateQuote(draft);
  assert.equal(draft.customer.dueDate, "");
  for (const categoryId of ["other", "future-editable-category"]) {
    draft.product.categoryId = categoryId;
    draft.product.modelId = "future-editable-model";
    draft.customer.status = "W produkcji";
    assert.deepEqual(calculateQuote(draft), expected);
  }
});

test("cost and planned-earnings subtotals reconcile, including grosz rounding", () => {
  for (const mass of ["0,001", "0,005", "0,015", "1,123", "5,5"]) {
    const draft = workshopExample();
    Object.assign(draft.gold, { mass, purchasePerGram: "0,99", markupPerGram: "1,01" });
    const { totals } = calculateQuote(draft);
    assert.equal(totals.gold.customerCharge, totals.gold.purchaseCost + totals.gold.profit);
    assert.equal(totals.totalCost, totals.gold.purchaseCost + totals.stoneCost + totals.externalCost);
    assert.equal(totals.plannedProfit, totals.gold.profit + totals.stoneProfit + totals.labor);
    assert.equal(totals.calculatedNet, totals.totalCost + totals.plannedProfit);
    assert.equal(totals.gross, totals.net + totals.vat);
  }
});

test("editing saved inputs recalculates mass, stone purchase and added labor without mutating the original", () => {
  const original = workshopExample();
  const before = structuredClone(original);
  const edited = structuredClone(original);
  edited.gold.mass = "6";
  edited.stones[0].purchasePrice = "250";
  edited.labor.push({ id: "engraving", name: "Grawer", amount: "100" });
  const { totals, errors } = calculateQuote(edited);
  assert.deepEqual(errors, {});
  assert.equal(totals.gold.purchaseCost, 210000);
  assert.equal(totals.gold.profit, 210000);
  assert.equal(totals.stoneCost, 25000);
  assert.equal(totals.labor, 210000);
  assert.equal(totals.totalCost, 238500);
  assert.equal(totals.plannedProfit, 500000);
  assert.equal(totals.net, 738500);
  assert.equal(totals.vat, 169855);
  assert.equal(totals.gross, 908355);
  assert.equal(edited.gold.purchasePerGram, "350");
  assert.deepEqual(original, before);
});

// Current quote model: these fixtures deliberately use the new defaults.
function netCostExample() {
  const draft = createCurrentQuote("2026-09-06");
  draft.product.weight = "5,5";
  draft.gold.purchasePerGram = "350";
  draft.stones = [{ id: "diamond", name: "Diament", quantity: "1", purchasePrice: "200", plannedProfit: "800", customerOwned: false, priceBasis: "piece", carats: "0,5" }];
  draft.otherCosts = [{ id: "shipping", name: "Wysyłka", amount: "35" }];
  draft.pricing.desiredCleanProfit = "4158";
  return draft;
}

test("net costs: desired clean profit determines gross, VAT and estimated tax", () => {
  const { totals, errors } = calculateQuote(netCostExample());
  assert.deepEqual(errors, {});
  assert.equal(totals.gold.purchaseCost, 192500);
  assert.equal(totals.gold.profit, 0);
  assert.equal(totals.stoneProfit, 0);
  assert.equal(totals.totalCost, 216000);
  assert.equal(totals.net, 688500);
  assert.equal(totals.gross, 846855);
  assert.equal(totals.vat, 158355);
  assert.equal(totals.profit, 472500);
  assert.equal(totals.estimatedTax, 56700);
  assert.equal(totals.cleanProfit, 415800);
});

test("gross determines clean profit and owner's labor is never an actual cost", () => {
  const draft = netCostExample();
  draft.pricing.basis = "gross";
  draft.agreedGross = "8468.55";
  draft.pricing.desiredCleanProfit = "invalid inactive input";
  draft.gold.markupPerGram = "900";
  draft.labor = [{ id: "old", name: "Praca własna", amount: "2000" }];
  const { totals, errors } = calculateQuote(draft);
  assert.deepEqual(errors, {});
  assert.equal(totals.totalCost, 216000);
  assert.equal(totals.cleanProfit, 415800);
});

test("a loss never generates negative tax; intentional zero gross is supported", () => {
  const draft = netCostExample();
  draft.pricing.basis = "gross";
  for (const gross of ["1230", "0", ""]) {
    draft.agreedGross = gross;
    const { totals } = calculateQuote(draft);
    assert.equal(totals.estimatedTax, 0);
    assert.equal(totals.cleanProfit, totals.net - totals.totalCost);
    assert.ok(totals.cleanProfit < 0);
  }
});

test("carat prices multiply total ct only, piece prices multiply quantity", () => {
  const draft = netCostExample();
  Object.assign(draft.stones[0], { quantity: "3", carats: "0,375", purchasePrice: "1000,50", priceBasis: "carat" });
  assert.equal(calculateQuote(draft).totals.stoneCost, 37519);
  draft.stones[0].priceBasis = "piece";
  assert.equal(calculateQuote(draft).totals.stoneCost, 300150);
  draft.stones[0].customerOwned = true;
  draft.stones[0].purchasePrice = "inactive invalid";
  assert.equal(calculateQuote(draft).totals.stoneCost, 0);
});

test("historical customer gold retains manual mass and cost", () => {
  const draft = netCostExample();
  delete draft.gold.settlementVersion;
  draft.gold.source = "customer";
  draft.gold.customerLots = [{ id: "a", fineness: "585", mass: "2" }, { id: "b", fineness: "750", mass: "1,125" }];
  assert.equal(calculateQuote(draft).totals.customerGoldMilligrams, 3125);
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 0);
  draft.gold.source = "mixed";
  assert.equal(calculateQuote(draft).totals, null);
  draft.gold.ourMass = "1,5";
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 52500);
  assert.equal(calculateQuote(draft).totals.customerGoldMilligrams, 3125);
  draft.gold.customerLots[0].mass = "99";
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 52500);
});

test("product weight is the only source for our gold cost", () => {
  const draft = netCostExample();
  draft.gold.mass = "999";
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 192500);
  draft.product.weight = "6";
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 210000);
});

test("net model validates fractions, negative input, quantity and overflow", () => {
  const bad = [
    d => { d.product.weight = "-1"; },
    d => { d.stones[0].carats = "0,0001"; },
    d => { d.stones[0].quantity = "0"; },
    d => { d.pricing.desiredCleanProfit = "-2"; },
    d => { d.product.weight = "1000000000"; d.gold.purchasePerGram = "1000000000"; },
  ];
  for (const mutate of bad) { const draft = netCostExample(); mutate(draft); assert.equal(calculateQuote(draft).totals, null); }
});

test("switching authoritative inputs never loops or mutates draft; rounding reconciles", async () => {
  const { changePricing, priceInput } = await import("./pricing-draft.ts");
  const original = netCostExample();
  let draft = original;
  for (const target of ["0", "0,01", "0,44", "1234,56", "4158"]) {
    draft = changePricing(draft, "cleanProfit", target);
    const totals = calculateQuote(draft).totals;
    draft = changePricing(draft, "gross", priceInput(totals.gross));
    const reverse = calculateQuote(draft).totals;
    assert.equal(reverse.cleanProfit, totals.cleanProfit);
    assert.equal(reverse.net + reverse.vat, reverse.gross);
    assert.equal(reverse.totalCost + reverse.profit, reverse.net);
    assert.equal(reverse.cleanProfit + reverse.estimatedTax, reverse.profit);
  }
  assert.equal(original.pricing.basis, "cleanProfit");
  assert.equal(original.agreedGross, "");
});

test("legacy conversion is explicit, preserves entered prices and final gross", async () => {
  const { convertToNetCostPricing } = await import("./pricing-draft.ts");
  const old = workshopExample();
  const before = structuredClone(old);
  const totals = calculateQuote(old).totals;
  const converted = convertToNetCostPricing(old, totals);
  assert.deepEqual(old, before);
  assert.equal(converted.product.weight, "5,5");
  assert.equal(converted.gold.purchasePerGram, "350");
  assert.equal(calculateQuote(converted).totals.gross, totals.gross);
  assert.equal(calculateQuote(converted).totals.totalCost, 216000);
});


test("snapshot extension rejects malformed pricing without accepting unknown calculators", async () => {
  const { validQuoteExtension } = await import("./snapshot-extension.ts");
  const draft = netCostExample();
  const snapshot = { ...draft, totals: calculateQuote(draft).totals };
  assert.equal(validQuoteExtension(snapshot), true);
  for (const modify of [s => { s.customer.nickname = {}; }, s => { s.gold.customerLots = [{}]; }, s => { s.stones[0].priceBasis = "unknown"; }, s => { s.pricing.model = "future"; }, s => { s.gold.settlementVersion = "future"; }, s => { delete s.totals.cleanProfit; }]) {
    const broken = structuredClone(snapshot); modify(broken); assert.equal(validQuoteExtension(broken), false);
  }
});


test("customer Au conversion, weighted fineness, loss boundary and mixed shortfall", () => {
  const draft = netCostExample();
  Object.assign(draft.gold, { source: "mixed", fineness: "585", estimatedMass: "3,000", customerLots: [
    { id: "a", fineness: "585", mass: "2" }, { id: "b", fineness: "750", mass: "1" },
  ] });
  const value = calculateGoldSettlement(draft.gold).value;
  assert.deepEqual(value, { physicalMilligrams: 3000, pureMilligrams: 1920, averageFineness: 640, targetFineness: 585,
    convertedMilligrams: 1920000 / 585, estimatedMilligrams: 3000, lossPercent: 15, lossMilligrams: 450,
    requiredMilligrams: 3450, balanceMilligrams: -9825000 / 58500 });
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 5878);
  draft.gold.estimatedMass = "3,001";
  assert.equal(calculateGoldSettlement(draft.gold).value.lossPercent, 10);
  assert.equal(calculateGoldSettlement(draft.gold).value.lossMilligrams, 300.1);
  draft.gold.source = "customer";
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 0);
  draft.gold.customerLots[0].mass = "10";
  assert.ok(calculateGoldSettlement(draft.gold).value.balanceMilligrams > 0);
  draft.gold.source = "mixed";
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 0);
});

test("gold settlement handles zero, no lots, exact balance, invalid fineness and fractional grams", () => {
  const draft = netCostExample();
  Object.assign(draft.gold, { source: "mixed", estimatedMass: "3", customerLots: [{ id: "a", mass: "3,450", fineness: "585" }] });
  assert.equal(calculateGoldSettlement(draft.gold).value.balanceMilligrams, 0);
  draft.gold.customerLots = [];
  assert.equal(calculateQuote(draft).totals.gold.ourMassMilligrams, 3450);
  draft.gold.estimatedMass = "0";
  assert.equal(calculateGoldSettlement(draft.gold).value.averageFineness, null);
  assert.equal(calculateQuote(draft).totals.gold.purchaseCost, 0);
  for (const fineness of ["0", "1001", "abc", "", "585,5", "-1"]) {
    draft.gold.customerLots = [{ id: "bad", mass: "1", fineness }];
    assert.equal(calculateQuote(draft).totals, null);
  }
  draft.gold.customerLots = [{ id: "a", mass: "0,001", fineness: "333" }];
  assert.equal(calculateGoldSettlement(draft.gold).value.pureMilligrams, 0.333);
  draft.gold.fineness = "0";
  assert.equal(calculateQuote(draft).totals, null);
});
