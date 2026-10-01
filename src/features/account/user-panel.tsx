"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuoteSync } from "../sync/sync-provider";
import { greeting } from "./display-name";

export function UserPanel() {
  const { view, controller } = useQuoteSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const text = greeting(view.user?.email);
  async function logout() {
    setBusy(true); setError(false);
    try { await controller.logout(); } catch { setError(true); } finally { setBusy(false); }
  }
  return <section aria-label="Panel użytkownika" className="mb-6 rounded-xl border border-sidebar-line bg-white/5 p-4">
    <p className="text-sm font-semibold">{text.title}</p>
    <p className="mt-1 text-xs text-sidebar-muted">{text.subtitle}</p>
    {!view.ready ? <p className="mt-4 text-xs text-sidebar-muted">Odtwarzanie sesji…</p> : <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-sidebar-muted">{view.user ? "Zalogowano" : "Nie jesteś zalogowany"}</span>
      {view.user ? <button type="button" className="min-h-10 underline underline-offset-4 disabled:opacity-50" disabled={busy} onClick={() => void logout()}>{busy ? "Wylogowywanie…" : "Wyloguj"}</button> : <Link className="inline-flex min-h-10 items-center underline underline-offset-4" href="/logowanie">Zaloguj</Link>}
    </div>}
    {(!busy && (error || (view.user && view.summary?.binding?.syncPaused))) && <p role="alert" className="mt-2 text-xs">Nie udało się wylogować. Spróbuj ponownie na stronie konta.</p>}
  </section>;
}
