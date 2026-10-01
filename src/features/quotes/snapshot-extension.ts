/** Validate additive quote fields without changing the Dexie or cloud record schema. */
export function validQuoteExtension(value: Record<string, unknown>): boolean {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const optionalStrings = (item: unknown, keys: string[]) => object(item) && keys.every(key => item[key] === undefined || typeof item[key] === "string");
  if (!optionalStrings(value.customer, ["nickname"]) || !optionalStrings(value.product, ["size", "goldColor", "weight", "colorOne", "colorTwo"])) return false;
  if (object(value.product) && value.product.twoColors !== undefined && typeof value.product.twoColors !== "boolean") return false;
  if (object(value.gold) && value.gold.settlementVersion !== undefined && value.gold.settlementVersion !== "fine-au-v1") return false;
  if (!optionalStrings(value.gold, ["ourMass", "estimatedMass"])) return false;
  if (object(value.gold) && value.gold.customerLots !== undefined && (!Array.isArray(value.gold.customerLots) || !value.gold.customerLots.every(lot => object(lot) && ["id", "fineness", "mass"].every(key => typeof lot[key] === "string")))) return false;
  if (!Array.isArray(value.stones) || !value.stones.every(stone => optionalStrings(stone, ["catalogId", "carats", "shape", "dimensions"]) && (stone.priceBasis === undefined || ["piece", "carat"].includes(stone.priceBasis)))) return false;
  if (value.pricing === undefined) return true;
  return object(value.pricing) && value.pricing.model === "net-costs-v1" && ["gross", "cleanProfit"].includes(String(value.pricing.basis)) && typeof value.pricing.desiredCleanProfit === "string"
    && object(value.totals) && ["estimatedTax", "cleanProfit", "customerGoldMilligrams"].every(key => Number.isSafeInteger((value.totals as Record<string, unknown>)[key]));
}
