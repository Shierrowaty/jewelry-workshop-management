"use client";

import { useEffect, useRef, useState } from "react";

export function PwaStatus() {
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const connectivity = () => setOffline(!navigator.onLine);
    connectivity();
    const check = () => {
      if (navigator.onLine && document.visibilityState === "visible") void registration?.update().catch(() => {});
    };
    const inspect = () => {
      if (disposed || !registration) return;
      setWaiting(registration.waiting);
      if (registration.active) setReady(true);
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (disposed) return;
        if (installing.state === "redundant") setError("Nie uda\u0142o si\u0119 pobra\u0107 pakietu offline lub aktualizacji. Sprawd\u017a po\u0142\u0105czenie i wolne miejsce, a nast\u0119pnie od\u015bwie\u017c stron\u0119.");
        inspect();
      }, { once: true });
    };
    const changed = () => {
      if (requested.current) window.location.reload();
      else inspect();
    };
    const message = (event: MessageEvent) => {
      if (event.data?.type === "UPDATE_BLOCKED") {
        requested.current = false;
        setError("Zamknij pozostałe karty i okna aplikacji, a następnie wybierz Zaktualizuj ponownie.");
      }
    };
    window.addEventListener("offline", connectivity);
    window.addEventListener("online", connectivity);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    navigator.serviceWorker.addEventListener("message", message);
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.getRegistration("/").then(existing => {
        if (existing?.active?.scriptURL === `${location.origin}/sw.js`) return existing;
        return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      }).then(value => {
        if (disposed) return;
        registration = value;
        inspect();
        value.addEventListener("updatefound", inspect);
        check();
      }).catch(() => { if (!disposed) setError("Nie udało się przygotować aplikacji offline. Połącz się z internetem i odśwież stronę."); });
    } else {
      // The launcher remains a dev tool. Remove only our registration, never Dexie.
      void navigator.serviceWorker.getRegistration("/").then(value => {
        if (value?.active?.scriptURL === `${location.origin}/sw.js`) void value.unregister();
      });
    }
    const timer = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      registration?.removeEventListener("updatefound", inspect);
      window.removeEventListener("offline", connectivity);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      navigator.serviceWorker.removeEventListener("message", message);
    };
  }, []);
  if (process.env.NODE_ENV !== "production") return null;
  return <aside aria-label="Aplikacja offline" className="border-b border-line bg-gold-soft px-6 py-3 text-xs leading-6 text-ink sm:px-10 lg:px-12">
    <p role="status">{offline ? "Tryb offline — pracujesz na danych lokalnych. Synchronizacja poczeka na internet." : ready ? "Aplikacja gotowa do pracy offline na tym urządzeniu." : "Przygotowywanie aplikacji do pracy offline…"}</p>
    {waiting && <div className="flex flex-wrap items-center gap-3"><span>Dostępna jest nowa wersja aplikacji</span><button type="button" className="min-h-11 rounded-lg bg-ink px-4 font-semibold text-white" onClick={() => {
      if (!window.confirm("Zaktualizować aplikację? Najpierw zapisz zmiany w formularzu. Ta akcja odświeży okno.")) return;
      requested.current = true;
      setError(null);
      waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    }}>Zaktualizuj</button></div>}
    {error && <p role="alert">{error}</p>}
  </aside>;
}
