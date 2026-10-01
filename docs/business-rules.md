# Business rules

These are the workshop's implemented quotation assumptions, not a general accounting or tax engine.

## Financial model

All entered purchase and external costs are net amounts. The current model uses VAT of 23% and an estimated deduction of 12% from positive quotation profit. Owner labor is treated as earnings rather than an external cost; operating overhead is not automatically included.

| Symbol | Meaning |
| --- | --- |
| C | Own-gold cost + own-stone cost + external costs |
| G | Final gross price |
| N | Net revenue |
| P | Quotation profit before the estimated deduction |
| T | Estimated deduction |
| E | Estimated earnings after the deduction |

For a gross-price input:

- N = G / 1.23
- P = N − C
- T = max(P × 0.12, 0)
- E = P − T
- VAT = G − N

For a desired-earnings input, the calculator first computes P = E / 0.88 and G = (C + P) × 1.23. It then reconciles all displayed totals with the rounded final gross price.

Amounts are stored as integer grosz. Intermediate arithmetic uses BigInt and half-up rounding. Inputs accept a comma or dot decimal separator. Monetary amounts have two decimal places; masses have three.

## Customer gold

1. For each lot, fine-gold mass = physical mass × fineness / 1000.
2. Sum the fine-gold masses and divide by target fineness/1000 to obtain an equivalent mass at the target fineness.
3. Apply the workshop allowance to the estimated product mass: 15% up to and including 3.000 g, 10% above 3.000 g.
4. Required mass = estimated mass × (1 + allowance).
5. Balance = converted mass − required mass.

The allowance increases the required product mass; the implementation does not subtract it from supplied gold.

With workshop-owned gold, cost is product weight × purchase price per gram. With mixed gold, cost is the exact positive shortfall × purchase price per gram. With customer-owned gold, material cost is zero even when a shortfall remains visible. Fineness must be between 1 and 1000.

Example: 2 g at 585 and 1 g at 750 contain 1.920 g fine gold. At target fineness 585, this is approximately 3.282 g. A 3 g product requires 3.450 g after the allowance. The exact shortfall at 350 PLN/g costs 58.78 PLN net. Intermediate masses are not rounded before calculating the cost.

## Stones

- Per piece: quantity × net unit price.
- Per carat: total entered carat weight × net price per carat; quantity is not multiplied again.
- A customer-owned stone contributes zero material cost.
- Informational stone VAT is not added again to the quotation's net costs.

## Record lifecycle

A customer name or nickname is required to save a quotation. Completion is an explicit action and remains separate from the order status. A completed order can be edited without being restored to active work.

Saved records retain quotation inputs, chosen product labels and calculated totals. A metadata-only update does not reprice the order. Full form save deliberately replaces the snapshot and checks its revision.

Historical pricing models and gold-settlement fields remain supported. Their presence is data compatibility, not Git history. A past quotation date is compared with the record's creation day in Europe/Warsaw.

Source of truth: src/features/quotes/calculations.ts and its regression tests.
