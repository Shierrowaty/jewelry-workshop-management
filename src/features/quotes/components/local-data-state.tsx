"use client";

import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";

export function LocalDataError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm leading-6 text-red-800">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border border-red-300 px-4 font-semibold hover:bg-red-100">Spróbuj ponownie</button>
    </div>
  );
}

export function LocalStorageNotice() {
  const [protectedStorage, setProtectedStorage] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const persisted = await navigator.storage?.persisted?.();
        if (active) setProtectedStorage(persisted ?? false);
      } catch {
        if (active) setProtectedStorage(false);
      }
    }
    void check();
    return () => { active = false; };
  }, []);
  return (
    <div className="flex items-start gap-2.5 text-xs leading-5 text-muted">
      <HardDrive size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
      <p>Dane są lokalne dla tej przeglądarki, urządzenia i adresu aplikacji. Korzystaj z tego samego adresu i zwykłego profilu przeglądarki. Wyczyszczenie danych witryny usuwa wyceny.
        {protectedStorage === false && " Przeglądarka nie potwierdziła ochrony przed automatycznym zwalnianiem miejsca."}
        {protectedStorage === true && " Przeglądarka potwierdziła ochronę przed automatycznym zwalnianiem miejsca."}
      </p>
    </div>
  );
}
