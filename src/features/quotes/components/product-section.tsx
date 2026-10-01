import type { ProductCatalog, QuoteDraft, QuoteErrors } from "../types";
import { CheckboxField, NumericField, SelectField, TextareaField, TextField } from "./fields";
import { goldColors } from "../catalog";
import { FormSection } from "./form-section";

type Product = QuoteDraft["product"];

export function ProductSection({ value, catalog, errors, onChange }: { value: Product; catalog: ProductCatalog; errors: QuoteErrors; onChange: (patch: Partial<Product>) => void }) {
  const models = catalog.models.filter((model) => model.categoryId === value.categoryId);
  return (
    <FormSection number="02" title="Produkt" description="Kategorie i modele są na tym etapie przykładowe.">
      <SelectField label="Kategoria produktu" name="productCategory" value={value.categoryId} onChange={(event) => onChange({ categoryId: event.target.value, modelId: "" })}>
        <option value="">Wybierz kategorię</option>
        {catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </SelectField>
      <CheckboxField label="Projekt indywidualny" name="customDesign" checked={value.customDesign} onChange={(event) => onChange({ customDesign: event.target.checked })} />
      {value.customDesign ? (
        <TextField label="Model / nazwa produktu" name="customProductName" value={value.customName} onChange={(event) => onChange({ customName: event.target.value })} placeholder="Nazwa projektu indywidualnego" />
      ) : (
        <SelectField label="Model / nazwa produktu" name="productModel" value={value.modelId} disabled={!value.categoryId} onChange={(event) => onChange({ modelId: event.target.value })}>
          <option value="">{value.categoryId ? "Wybierz model" : "Najpierw wybierz kategorię"}</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </SelectField>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Rozmiar" name="productSize" value={value.size ?? ""} onChange={(event) => onChange({ size: event.target.value })} />
        {!value.twoColors && <SelectField label="Kolor złota" name="productGoldColor" value={value.goldColor ?? "Żółte"} onChange={(event) => onChange({ goldColor: event.target.value })}>
          {value.goldColor && !goldColors.includes(value.goldColor) && <option>{value.goldColor}</option>}
          {goldColors.map(color => <option key={color}>{color}</option>)}
        </SelectField>}
        <NumericField label="Waga produktu (g)" name="productWeight" unit="g" value={value.weight ?? ""} error={errors["product.weight"]} onChange={(event) => onChange({ weight: event.target.value })} />
      </div>
      <CheckboxField label="Dwa kolory złota" name="twoGoldColors" checked={value.twoColors ?? false} onChange={(event) => onChange({ twoColors: event.target.checked })} />
      {value.twoColors && <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Kolor 1 / element" name="colorOne" placeholder="Szyna z żółtego złota" value={value.colorOne ?? ""} onChange={(event) => onChange({ colorOne: event.target.value })} />
        <TextField label="Kolor 2 / element" name="colorTwo" placeholder="Oprawka z białego złota" value={value.colorTwo ?? ""} onChange={(event) => onChange({ colorTwo: event.target.value })} />
      </div>}
      <TextareaField label="Krótki opis wariantu" name="variant" rows={2} value={value.variant} onChange={(event) => onChange({ variant: event.target.value })} placeholder="Np. szerokość, wykończenie" />
    </FormSection>
  );
}
