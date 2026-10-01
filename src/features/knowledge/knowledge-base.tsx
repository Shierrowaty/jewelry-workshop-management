"use client";

import { useState } from "react";
import { ArrowLeft, BookOpen, ChevronRight, Gem, Plus, Settings2 } from "lucide-react";
import { getQuoteDate } from "../quotes/defaults";
import { LocalDataError } from "../quotes/components/local-data-state";
import { SelectField, TextField } from "../quotes/components/fields";
import { CategoryManager } from "./category-manager";
import { catalogGroups, departmentName, departments, entryGroupId, groupAssignment } from "./catalog";
import { EntryCard } from "./entry-card";
import { EntryEditor } from "./entry-editor";
import { filterKnowledge } from "./repository";
import { KnowledgeSyncNotice } from "./sync/notice";
import { emptyKnowledgeDraft, type KnowledgeDraft, type KnowledgeEntry, type KnowledgeFilters } from "./types";
import { useKnowledge } from "./use-knowledge";

export function KnowledgeBase() {
  const { result, retry } = useKnowledge();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KnowledgeFilters["kind"]>("");
  const [groupId, setGroupId] = useState("*");
  const [status, setStatus] = useState<KnowledgeFilters["status"]>("active");
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<{ initial: KnowledgeDraft; entry?: KnowledgeEntry } | null>(null);
  const [notice, setNotice] = useState("");
  const categories = result?.data?.categories ?? [];
  const allEntries = result?.data?.entries ?? [];
  const searching = Boolean(search.trim());
  const groups = kind ? catalogGroups(categories, kind, allEntries) : [];
  const entries = filterKnowledge(allEntries, categories, { search, kind: searching ? "" : kind, categoryId: "", subcategoryId: "", status: managing ? status : "active" })
    .filter(entry => searching || groupId === "*" || entryGroupId(entry, categories) === groupId);
  const recent = !managing && !kind && !searching;
  const visible = recent ? entries.slice(0, 6) : entries;
  const heading = searching ? "Wyniki wyszukiwania" : recent ? "Ostatnio dodane i zmienione" : kind ? groupId === "*" ? `Wszystkie rekordy — ${departmentName(kind)}` : groupId ? groups.find(group => group.id === groupId)?.label ?? "Grupa niedostępna" : "Bez grupy" : "Rekordy";
  function reset() { setSearch(""); setKind(""); setGroupId("*"); setStatus("active"); }
  function openDepartment(value: KnowledgeFilters["kind"]) { setKind(value); setGroupId(value ? "" : "*"); setSearch(""); }
  const secondary = "inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-gold-soft";

  return <section aria-labelledby="page-title" className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true" /><h1 id="page-title" className="font-display text-4xl sm:text-5xl">{managing ? "Zarządzaj bazą" : "Baza wiedzy"}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{managing ? "Grupy, archiwum i porządkowanie rekordów." : "Kamienie i wyroby w jednym miejscu. Znajdź dane, ceny i notatki potrzebne do kolejnej wyceny."}</p></div>
      {!editing && <div className="flex flex-wrap gap-2">
        <button disabled={!result?.data} onClick={() => { setNotice(""); setEditing({ initial: { ...emptyKnowledgeDraft(getQuoteDate(new Date()), kind || "stone"), ...groupAssignment(groupId, categories) } }); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sidebar px-4 text-sm font-semibold text-sidebar-text disabled:opacity-50"><Plus size={18} aria-hidden="true" />Dodaj rekord</button>
        <button className={secondary} onClick={() => { setManaging(!managing); reset(); setNotice(""); }}>{managing ? <ArrowLeft size={16} aria-hidden="true" /> : <Settings2 size={16} aria-hidden="true" />}{managing ? "Wróć do katalogu" : "Zarządzaj bazą"}</button>
      </div>}
    </header>
    {!result && <p role="status" className="text-sm text-muted">Wczytywanie Bazy wiedzy…</p>}
    {result?.error && <LocalDataError message={result.error} onRetry={retry} />}
    {result?.data && <>
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}
      {editing ? <EntryEditor key={editing.entry?.id ?? "new"} initial={editing.initial} entry={editing.entry} categories={categories} entries={allEntries} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reset(); setNotice("Rekord zapisany w Bazie wiedzy."); }} /> : <>
        {managing && <CategoryManager categories={categories} entries={allEntries} />}
        <section aria-label="Wyszukiwanie i filtry" className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <TextField label="Szukaj w Bazie wiedzy" type="search" placeholder="Nazwa, dostawca, kształt lub uwagi…" value={search} onChange={event => setSearch(event.target.value)} hint={searching ? "Przeszukujesz oba działy i wszystkie grupy." : undefined} />
          <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Filtry</summary><div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Filtr działu" value={kind} disabled={searching} onChange={event => { setKind(event.target.value as KnowledgeFilters["kind"]); setGroupId("*"); }}><option value="">Wszystkie działy</option>{departments.map(item => <option key={item.kind} value={item.kind}>{item.name}</option>)}</SelectField>
            <SelectField label="Filtr grupy" value={groupId} disabled={!kind || searching} onChange={event => setGroupId(event.target.value)}><option value="*">Wszystkie grupy</option><option value="">Bez grupy</option>{groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</SelectField>
          </div></details>
          {managing && <SelectField label="Widok rekordów" value={status} onChange={event => setStatus(event.target.value as KnowledgeFilters["status"])}><option value="active">Aktywne</option><option value="archived">Archiwum</option><option value="all">Wszystkie</option></SelectField>}
          {(search || kind || status !== "active") && <button onClick={reset} className="min-h-11 text-sm font-medium text-muted underline underline-offset-4">Wyczyść filtry</button>}
        </section>
        {!managing && !searching && <>
          {!kind ? <nav aria-label="Działy Bazy wiedzy" className="grid gap-4 sm:grid-cols-2">{departments.map(item => <button key={item.kind} onClick={() => openDepartment(item.kind)} className="group flex min-w-0 items-center gap-4 rounded-2xl border border-line bg-surface p-6 text-left transition-colors hover:border-gold hover:bg-gold-soft">
            <Gem size={28} className="shrink-0 text-gold" aria-hidden="true" /><span className="flex-1"><span className="block font-display text-3xl">{item.name}</span><span className="mt-2 block text-sm text-muted">Rekordy: {allEntries.filter(entry => entry.kind === item.kind && !entry.archivedAt).length} · Przeglądaj dział</span></span><ChevronRight size={20} aria-hidden="true" />
          </button>)}</nav> : <>
            <nav aria-label="Ścieżka Bazy wiedzy" className="flex flex-wrap items-center gap-2 text-sm"><button onClick={reset} className="min-h-11 underline">Baza wiedzy</button><ChevronRight size={14} aria-hidden="true" /><button onClick={() => openDepartment(kind)} className="min-h-11 underline">{departmentName(kind)}</button>{groupId && groupId !== "*" && <><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{heading}</span></>}</nav>
            <section aria-label="Grupy działu" className="space-y-3"><h2 className="font-display text-3xl">{departmentName(kind)}</h2><div className="flex flex-wrap gap-2">
              <button className={secondary} aria-pressed={groupId === ""} onClick={() => setGroupId("")}>Bez grupy</button>
              {groups.map(group => <button key={group.id} className={`${secondary} ${groupId === group.id ? "bg-gold-soft font-semibold" : "bg-surface"}`} aria-pressed={groupId === group.id} onClick={() => setGroupId(group.id)}>{group.label}</button>)}
            </div>{!groups.length && <p className="text-sm text-muted">W tym dziale nie ma jeszcze grup. Możesz je dodać w „Zarządzaj bazą”.</p>}</section>
          </>}
        </>}
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-display text-3xl">{heading}</h2><p className="text-sm text-muted" aria-live="polite">{recent ? `Pokazano: ${visible.length} z ${entries.length}` : `Liczba rekordów: ${entries.length}`}</p></div>
        {!visible.length && <div className="rounded-2xl border border-dashed border-line bg-surface px-5 py-10 text-center"><BookOpen className="mx-auto mb-3 text-gold" aria-hidden="true" /><h3 className="font-display text-2xl">{!allEntries.length ? "Twoja baza czeka na pierwszy wpis" : "Brak pasujących rekordów"}</h3><p className="mt-3 text-sm text-muted">{!allEntries.length ? "Wybierz „Dodaj rekord”. Grupę możesz przypisać teraz lub później." : "Wybierz inną grupę lub zmień wyszukiwanie i filtry."}</p></div>}
        <div className="grid items-start gap-5 2xl:grid-cols-2">{visible.map(entry => <EntryCard key={entry.id} entry={entry} categories={categories} managing={managing} onEdit={() => { setNotice(""); setEditing({ initial: entry, entry }); }} />)}</div>
      </>}
      <KnowledgeSyncNotice />
    </>}
  </section>;
}
