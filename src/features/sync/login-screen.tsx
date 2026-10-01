"use client";

import Link from "next/link";
import { useState } from "react";
import { TextField } from "../quotes/components/fields";
import { useQuoteSync } from "./sync-provider";

const buttonClass = "min-h-11 rounded-xl bg-sidebar px-5 py-3 text-sm font-semibold text-sidebar-text hover:bg-sidebar-active disabled:opacity-50";
export function LoginScreen() {
  const { controller, view } = useQuoteSync();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Nie udało się wykonać operacji."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="page-title" className="mx-auto max-w-2xl">
    <span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true" />
    <h1 id="page-title" className="font-display text-4xl font-medium text-ink sm:text-5xl">Konto i synchronizacja</h1>
    <p className="mt-3 text-sm leading-6 text-muted">Połącz wyceny, zdjęcia i Bazę wiedzy między urządzeniami. Każda zmiana najpierw zapisuje się na tym urządzeniu, a potem synchronizuje z pracownią.</p>
    <div className="mt-7 space-y-5 rounded-2xl border border-line bg-surface p-6 sm:p-8">
      {!view.ready ? <p role="status">Odtwarzanie sesji… Możesz korzystać z lokalnych wycen.</p> : !view.user ? <form className="space-y-5" onSubmit={event => { event.preventDefault(); void act(async () => { try { await controller.login(email, password); } finally { setPassword(""); } }); }}>
        <TextField label="E-mail" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
        <TextField label="Hasło" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
        <button className={buttonClass} disabled={busy || !view.online}>{busy ? "Logowanie…" : "Zaloguj się"}</button>
        <p className="text-xs leading-5 text-muted">Konta tworzy administrator pracowni. Do pracy lokalnej nie potrzebujesz logowania.</p>
      </form> : <>
        <div><p className="text-xs text-muted">Zalogowane konto</p><p className="mt-1 break-all font-semibold text-ink">{view.user.email}</p></div>
        {view.workspace && <div><p className="text-xs text-muted">Pracownia</p><p className="mt-1 font-semibold text-ink">{view.workspace.name}</p></div>}
        {view.workspace && view.summary && !view.summary.binding && <div className="space-y-3 rounded-xl border border-gold/25 bg-gold-soft p-4 text-sm leading-6">
          <p>Połączenie przypisze lokalne wyceny ({view.summary.total}) do pracowni <strong>{view.workspace.name}</strong> i rozpocznie synchronizację wycen, ich zdjęć oraz wszystkich lokalnych kategorii i rekordów Bazy wiedzy. Ta baza pozostanie powiązana z tą pracownią także po wylogowaniu.</p>
          <button className={buttonClass} disabled={busy || view.busy || !view.online} onClick={() => void act(() => controller.connect())}>Połącz i synchronizuj dane</button>
        </div>}
        <Link href="/" className="text-sm text-gold underline">Synchronizacja i diagnostyka na Pulpicie</Link>
        <button type="button" className="min-h-11 rounded-xl border border-line px-5 py-3 text-sm font-semibold" disabled={busy} onClick={() => void act(() => controller.logout())}>Wyloguj się</button>
      </>}
      {(error || view.message) && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{error ?? view.message}</p>}
      {!view.online && <p className="text-sm text-muted">Brak internetu. Lokalne wyceny są nadal dostępne. Synchronizacja zostanie ponowiona po odzyskaniu połączenia.</p>}
      {!!view.summary?.photoConflicts.length && <div className="space-y-2"><h2 className="font-semibold text-amber-900">Konflikty zdjęć</h2><p className="text-xs text-muted">Pliki zachowano. Inna zawartość pod tym samym UUID wymaga wyjaśnienia z administratorem.</p><ul>{view.summary.photoConflicts.map(photo => <li key={photo.id}><Link href={`/realizacje/${photo.quoteId}`} className="text-sm text-gold underline">Otwórz realizację ze zdjęciem w konflikcie</Link></li>)}</ul></div>}
      {!!view.summary?.conflicts.length && <div className="space-y-2"><h2 className="font-semibold text-amber-900">Wyjaśnij konflikty</h2><ul className="space-y-2">{view.summary.conflicts.map(quote => <li key={quote.id}><Link href={`/realizacje/${quote.id}`} className="text-sm text-gold underline underline-offset-4">{quote.name}</Link></li>)}</ul></div>}
    </div>
    <Link href="/realizacje" className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-gold underline underline-offset-4">Przejdź do lokalnych realizacji</Link>
  </section>;
}
