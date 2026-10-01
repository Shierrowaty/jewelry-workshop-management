import { emptyState, syncKey } from "./sync/types";
import { getLocalDatabase, type QuotesDatabase } from "../quotes/data/database";
import { calculateKnowledge } from "./calculations";
import { departmentKind, departmentName } from "./catalog";
import type { KnowledgeCategory, KnowledgeDraft, KnowledgeEntry, KnowledgeFilters } from "./types";

export class KnowledgeError extends Error {}
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl");

export class KnowledgeRepository {
  constructor(private readonly database: QuotesDatabase) {}

  private async ensureDepartment(kind: KnowledgeDraft["kind"]) {
    const categories = await this.database.knowledgeCategories.toArray();
    return categories.find(category => departmentKind(category) === kind) ?? this.createCategory(departmentName(kind), null);
  }

  async createGroup(name: string, kind: KnowledgeDraft["kind"]) {
    return this.database.transaction("rw", this.database.knowledgeCategories, async () => {
      const root = await this.ensureDepartment(kind);
      return this.createCategory(name, root.id);
    });
  }

  async renameGroup(previous: KnowledgeCategory, name: string) {
    return this.database.transaction("rw", this.database.knowledgeCategories, async () => {
      const current = await this.database.knowledgeCategories.get(previous.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(previous)) throw new KnowledgeError("Grupę zmieniono w innym oknie. Otwórz jej aktualną wersję.");
      if (departmentKind(current)) throw new KnowledgeError("Nazwy działów są stałe.");
      const trimmed = name.trim().replace(/\s+/g, " ");
      if (!trimmed) throw new KnowledgeError("Podaj nazwę grupy.");
      // A legacy root must not turn into a department through a rename.
      if (departmentKind({ ...current, name: trimmed })) throw new KnowledgeError("Ta nazwa jest zarezerwowana dla działu.");
      const siblings = await this.database.knowledgeCategories.toArray();
      if (siblings.some(item => item.id !== current.id && item.parentId === current.parentId && normalize(item.name) === normalize(trimmed))) throw new KnowledgeError("Taka grupa już istnieje w tym miejscu.");
      const updated = { ...current, name: trimmed, revision: (current.revision ?? 0) + 1, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt ?? current.createdAt) + 1)).toISOString() };
      await this.database.knowledgeCategories.put(updated);
      return updated;
    });
  }

  async saveCatalogEntry(draft: KnowledgeDraft, previous?: Pick<KnowledgeEntry, "id" | "revision">) {
    return this.database.transaction("rw", this.database.knowledgeCategories, this.database.knowledgeEntries, async () => {
      const categoryId = draft.categoryId || (await this.ensureDepartment(draft.kind)).id;
      return this.save({ ...draft, categoryId }, previous);
    });
  }

  async list() {
    return this.database.transaction("r", this.database.knowledgeCategories, this.database.knowledgeEntries, async () => ({
      categories: (await this.database.knowledgeCategories.toArray()).sort((a, b) => a.name.localeCompare(b.name, "pl")),
      entries: await this.database.knowledgeEntries.orderBy("updatedAt").reverse().toArray(),
    }));
  }

  async createCategory(name: string, parentId: string | null): Promise<KnowledgeCategory> {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) throw new KnowledgeError("Podaj nazwę grupy.");
    return this.database.transaction("rw", this.database.knowledgeCategories, async () => {
      if (parentId !== null) {
        const parent = await this.database.knowledgeCategories.get(parentId);
        if (!parent || parent.parentId !== null) throw new KnowledgeError("Grupę można dodać tylko bezpośrednio do działu.");
      }
      const siblings = await this.database.knowledgeCategories.toArray();
      if (siblings.some(item => item.parentId === parentId && normalize(item.name) === normalize(trimmed))) throw new KnowledgeError("Taka grupa już istnieje w tym miejscu.");
      const category: KnowledgeCategory = { id: crypto.randomUUID(), name: trimmed, parentId, createdAt: new Date().toISOString() };
      await this.database.knowledgeCategories.add(category);
      return category;
    });
  }

  async save(draft: KnowledgeDraft, previous?: Pick<KnowledgeEntry, "id" | "revision">): Promise<KnowledgeEntry> {
    // Persist only editable fields; metadata can never be supplied by the caller.
    const input: KnowledgeDraft = {
      kind: draft.kind, categoryId: draft.categoryId, subcategoryId: draft.subcategoryId, name: draft.name.trim(), notes: draft.notes, entryDate: draft.entryDate,
      supplier: draft.supplier, shape: draft.shape, dimensions: draft.dimensions, carats: draft.carats, priceBasis: draft.priceBasis, unitNetPrice: draft.unitNetPrice,
      referenceWeight: draft.referenceWeight, fineness: draft.fineness, goldColor: draft.goldColor, goldPricePerGram: draft.goldPricePerGram,
      materialCost: draft.materialCost, laborPrice: draft.laborPrice, finishedPrice: draft.finishedPrice,
    };
    const { errors } = calculateKnowledge(input);
    if (Object.keys(errors).length) throw new KnowledgeError("Popraw zaznaczone pola przed zapisaniem rekordu.");
    return this.database.transaction("rw", this.database.knowledgeCategories, this.database.knowledgeEntries, async () => {
      const category = await this.database.knowledgeCategories.get(input.categoryId);
      if (!category || category.parentId !== null) throw new KnowledgeError("Wybierz istniejący dział lub grupę.");
      if (input.subcategoryId) {
        const subcategory = await this.database.knowledgeCategories.get(input.subcategoryId);
        if (!subcategory || subcategory.parentId !== category.id) throw new KnowledgeError("Grupa nie należy do wybranego działu.");
      }
      const current = previous ? await this.requireRevision(previous.id, previous.revision) : undefined;
      const timestamp = new Date(Math.max(Date.now(), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
      const entry: KnowledgeEntry = { ...input, id: current?.id ?? crypto.randomUUID(), revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp, archivedAt: current?.archivedAt ?? null };
      await this.database.knowledgeEntries.put(entry);
      return entry;
    });
  }

  async setArchived(id: string, revision: number, archived: boolean) {
    return this.database.transaction("rw", this.database.knowledgeEntries, async () => {
      const entry = await this.requireRevision(id, revision);
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(entry.updatedAt) + 1)).toISOString();
      await this.database.knowledgeEntries.put({ ...entry, updatedAt, revision: entry.revision + 1, archivedAt: archived ? updatedAt : null });
    });
  }

  async remove(id: string, revision: number) {
    await this.database.transaction("rw", this.database.knowledgeEntries, this.database.knowledgeSync, async () => {
      const entry = await this.requireRevision(id, revision);
      const state = await this.database.knowledgeSync.get(syncKey("knowledge_entries", id)) ?? emptyState("knowledge_entries", id);
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(entry.updatedAt) + 1)).toISOString();
      await this.database.knowledgeSync.put({ ...state, deletedEntry: { ...entry, revision: entry.revision + 1, updatedAt } });
      await this.database.knowledgeEntries.delete(id);
    });
  }

  private async requireRevision(id: string, revision: number) {
    const entry = await this.database.knowledgeEntries.get(id);
    if (!entry) throw new KnowledgeError("Nie znaleziono rekordu. Odśwież listę.");
    if (entry.revision !== revision) throw new KnowledgeError("Rekord zmieniono w innym oknie. Otwórz jego aktualną wersję przed zapisem.");
    return entry;
  }
}

export function filterKnowledge(entries: KnowledgeEntry[], categories: KnowledgeCategory[], filters: KnowledgeFilters) {
  const query = normalize(filters.search);
  const names = new Map(categories.map(category => [category.id, category.name]));
  return entries.filter(entry => {
    if (filters.status === "active" && entry.archivedAt || filters.status === "archived" && !entry.archivedAt) return false;
    if (filters.categoryId && entry.categoryId !== filters.categoryId || filters.subcategoryId && entry.subcategoryId !== filters.subcategoryId || filters.kind && entry.kind !== filters.kind) return false;
    return !query || normalize([entry.name, entry.supplier, entry.shape, entry.dimensions, entry.notes, names.get(entry.categoryId), names.get(entry.subcategoryId)].filter(Boolean).join(" ")).includes(query);
  });
}

export function getKnowledgeRepository() { return new KnowledgeRepository(getLocalDatabase()); }
