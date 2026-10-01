import type { ProductCatalog } from "./types";

// Temporary examples, kept outside the UI and independent of calculations.
export const exampleCatalog: ProductCatalog = {
  categories: [
    { id: "rings", name: "Pierścionki" },
    { id: "bands", name: "Obrączki" },
    { id: "earrings", name: "Kolczyki" },
    { id: "pendants", name: "Zawieszki" },
    { id: "bracelets", name: "Bransoletki" },
    { id: "other", name: "Inne" },
  ],
  models: [
    { id: "ring-classic", categoryId: "rings", name: "Klasyczny z jednym kamieniem" },
    { id: "ring-halo", categoryId: "rings", name: "Halo" },
    { id: "band-classic", categoryId: "bands", name: "Obrączka klasyczna" },
    { id: "band-flat", categoryId: "bands", name: "Obrączka płaska" },
    { id: "earring-stud", categoryId: "earrings", name: "Sztyfty" },
    { id: "earring-hoop", categoryId: "earrings", name: "Koła" },
    { id: "pendant-medallion", categoryId: "pendants", name: "Medalion" },
    { id: "pendant-stone", categoryId: "pendants", name: "Zawieszka z kamieniem" },
    { id: "bracelet-chain", categoryId: "bracelets", name: "Bransoletka łańcuszkowa" },
    { id: "other-product", categoryId: "other", name: "Inny produkt" },
  ],
};

export const contactChannels = ["SMS", "WhatsApp", "e-mail", "Instagram", "Facebook", "Sklep", "osobiście", "inne"];
export const orderStatuses = ["Wycena", "Zaakceptowane", "W produkcji", "Gotowe", "Odebrane", "Anulowane"];
export const goldFinenesses = ["333", "375", "585", "750", "916", "999"];
export const goldColors = ["Żółte", "Białe", "Różowe"];
export const laborSuggestions = ["Wykonanie", "Oprawa kamienia", "Grawer", "Rodowanie"];
export const otherCostSuggestions = ["Wysyłka", "Pudełko", "Cechowanie", "Podwykonawca"];
