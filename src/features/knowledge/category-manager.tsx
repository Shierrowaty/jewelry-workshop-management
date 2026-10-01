import { useState } from "react";
import { SelectField, TextField } from "../quotes/components/fields";
import { catalogGroups, departments } from "./catalog";
import { getKnowledgeRepository } from "./repository";
import type { KnowledgeCategory, KnowledgeEntry, KnowledgeKind } from "./types";
import { knowledgeError } from "./use-knowledge";

export function CategoryManager({ categories, entries }: { categories: KnowledgeCategory[]; entries: KnowledgeEntry[] }) {
  const [kind, setKind] = useState<KnowledgeKind>("stone");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<KnowledgeCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const repository = getKnowledgeRepository();
      if (editing) await repository.renameGroup(editing, name);
      else await repository.createGroup(name, kind);
      setName(""); setEditing(null); setMessage("Grupa zapisana.");
    } catch (error) { setError(knowledgeError(error)); }
    finally { setBusy(false); }
  }
  return <section aria-label="Zarządzanie grupami" className="rounded-2xl border border-line bg-surface p-5">
    <h2 className="font-display text-3xl">Grupy</h2>
    <p className="my-3 text-sm text-muted">Wybierz dział i dodaj grupę. Rekordy mogą też pozostać bez grupy.</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
      <fieldset disabled={busy} className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <SelectField label="Dział grupy" value={kind} disabled={Boolean(editing)} onChange={event => setKind(event.target.value as KnowledgeKind)}>{departments.map(item => <option key={item.kind} value={item.kind}>{item.name}</option>)}</SelectField>
        <TextField label="Nazwa grupy" value={name} onChange={event => setName(event.target.value)} required />
        <button className="min-h-11 rounded-lg bg-sidebar px-4 text-sm font-semibold text-sidebar-text">{busy ? "Zapisywanie…" : editing ? "Zapisz nazwę" : "Dodaj grupę"}</button>
      </fieldset>
      {editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setName(""); setError(""); }} className="min-h-11 text-sm underline">Anuluj zmianę nazwy</button>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{message && <p role="status" className="text-sm text-emerald-900">{message}</p>}
    </form>
    <ul className="mt-5 grid gap-3 text-sm sm:grid-cols-2">{catalogGroups(categories, kind, entries).map(group => <li key={group.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-line p-3">
      <span className="break-words">{group.label}</span><button disabled={busy} onClick={() => { setEditing(categories.find(item => item.id === group.id)!); setName(group.name); setError(""); setMessage(""); }} className="min-h-11 shrink-0 px-2 underline" aria-label={`Zmień nazwę grupy ${group.label}`}>Zmień nazwę</button>
    </li>)}</ul>
  </section>;
}
