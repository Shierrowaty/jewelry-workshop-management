export type GoldSource = "ours" | "customer" | "mixed";

export type GoldDraft = {
  settlementVersion?: "fine-au-v1";
  customerLots?: { id: string; fineness: string; mass: string }[];
  estimatedMass?: string;
  ourMass?: string;
  source: GoldSource;
  fineness: string;
  color: string;
  mass: string;
  customerMass: string;
  purchasePerGram: string;
  markupPerGram: string;
};

export type StoneDraft = {
  catalogId?: string;
  carats?: string;
  shape?: string;
  dimensions?: string;
  priceBasis?: "carat" | "piece";
  id: string;
  name: string;
  quantity: string;
  purchasePrice: string;
  plannedProfit: string;
  customerOwned: boolean;
};

export type CostLineDraft = { id: string; name: string; amount: string };

export type QuoteDraft = {
  // Absent in historical snapshots: retain their original calculator on read.
  pricing?: { model: "net-costs-v1"; basis: "gross" | "cleanProfit"; desiredCleanProfit: string };
  customer: {
    nickname?: string;
    name: string;
    channel: string;
    contact: string;
    quoteDate: string;
    dueDate: string;
    status: string;
    notes: string;
  };
  product: {
    size?: string;
    goldColor?: string;
    weight?: string;
    twoColors?: boolean;
    colorOne?: string;
    colorTwo?: string;
    categoryId: string;
    modelId: string;
    customDesign: boolean;
    customName: string;
    variant: string;
  };
  gold: GoldDraft;
  stones: StoneDraft[];
  labor: CostLineDraft[];
  otherCosts: CostLineDraft[];
  vatRate: string;
  agreedGross: string;
};

// The form accepts plain catalog data; a future page can supply it from a database.
export type ProductCatalog = {
  categories: { id: string; name: string }[];
  models: { id: string; categoryId: string; name: string }[];
};

export type QuoteErrors = Record<string, string>;

export type StoneCatalog = { id: string; name: string }[];

export type StoneTotals = {
  costPerUnit: number;
  plannedProfitPerUnit: number;
  valuePerUnit: number;
  totalCost: number;
  totalProfit: number;
  totalValue: number;
};

// Every monetary result is an integer number of grosz, never a PLN float.
export type QuoteTotals = {
  estimatedTax?: number;
  cleanProfit?: number;
  customerGoldMilligrams?: number;
  gold: {
    ourMassMilligrams: number;
    customerPricePerGram: number;
    purchaseCost: number;
    customerCharge: number;
    profit: number;
  };
  stones: Record<string, StoneTotals>;
  stoneCost: number;
  materialCost: number;
  externalCost: number;
  totalCost: number;
  stoneProfit: number;
  labor: number;
  plannedProfit: number;
  plannedMarginPercent: number | null;
  calculatedNet: number;
  calculatedGross: number;
  priceAdjustment: number;
  net: number;
  vat: number;
  gross: number;
  profit: number; // Earnings at the final price, including an agreed-price adjustment.
  marginPercent: number | null;
  manualPrice: boolean;
};

export type QuoteCalculation = { errors: QuoteErrors; totals: QuoteTotals | null };
