"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { SyncController } from "./sync-controller";

const SyncContext = createContext<SyncController | null>(null);
export function SyncProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new SyncController());
  useEffect(() => controller.start(), [controller]);
  return <SyncContext.Provider value={controller}>{children}</SyncContext.Provider>;
}
export function useQuoteSync() {
  const controller = useContext(SyncContext);
  if (!controller) throw new Error("Brak kontekstu synchronizacji.");
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.serverSnapshot);
  return { controller, view };
}
