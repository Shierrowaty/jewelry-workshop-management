import type { KnowledgeCategory, KnowledgeDraft, KnowledgeEntry, KnowledgeKind } from "./types";

export const departments = [{ kind: "stone", name: "Kamienie" }, { kind: "product", name: "Wyroby" }] as const;
export const departmentName = (kind: KnowledgeKind) => departments.find(item => item.kind === kind)!.name;
export function departmentKind(category?: KnowledgeCategory) {
  return category?.parentId === null ? departments.find(item => item.name.toLocaleLowerCase("pl") === category.name.trim().toLocaleLowerCase("pl"))?.kind : undefined;
}

// A read-only projection: old IDs and parent relationships stay intact, including
// custom roots and independently created offline groups with identical names.
export function entryGroupId(entry: Pick<KnowledgeDraft, "categoryId" | "subcategoryId">, categories: KnowledgeCategory[]) {
  if (entry.subcategoryId) return entry.subcategoryId;
  const root = categories.find(item => item.id === entry.categoryId);
  return root && !departmentKind(root) ? root.id : "";
}

export function catalogGroups(categories: KnowledgeCategory[], kind: KnowledgeKind, entries: KnowledgeEntry[] = []) {
  const groups = categories.filter(category => {
    if (departmentKind(category)) return false;
    const root = category.parentId ? categories.find(item => item.id === category.parentId) : category;
    const assignedKind = departmentKind(root);
    return !assignedKind || assignedKind === kind || entries.some(entry => entry.kind === kind && entryGroupId(entry, categories) === category.id);
  }).map(category => {
    const parent = categories.find(item => item.id === category.parentId);
    const label = parent && !departmentKind(parent) ? `${parent.name} · ${category.name}` : category.name;
    return { ...category, label };
  });
  return groups.map(group => ({ ...group, label: groups.filter(other => other.label === group.label).length > 1 ? `${group.label} (${group.id.slice(0, 8)})` : group.label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pl"));
}

export function groupAssignment(id: string, categories: KnowledgeCategory[]) {
  const group = categories.find(item => item.id === id);
  return group ? { categoryId: group.parentId ?? group.id, subcategoryId: group.parentId ? group.id : "" } : { categoryId: "", subcategoryId: "" };
}

export function entryGroupName(entry: KnowledgeEntry, categories: KnowledgeCategory[]) {
  const id = entryGroupId(entry, categories);
  return id ? catalogGroups(categories, entry.kind, [entry]).find(item => item.id === id)?.label ?? "Grupa niedostępna" : "Bez grupy";
}
