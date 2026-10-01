import { version } from "../../../package.json";
import type { SyncView } from "../sync/sync-controller";
import { safeId, safeLog, type AppLog } from "./logs";
export const preferredOrigin = "http://127.0.0.1:3000";
export function originWarning(origin: string, development: boolean) {
  return development && origin !== preferredOrigin
    ? `Używaj ${preferredOrigin}. Inny host lub port oznacza osobną lokalną bazę IndexedDB i może wyglądać jak utrata danych. Dane pod poprzednim adresem nie zostały usunięte.` : null;
}
export function diagnosticReport(view: SyncView, logs: AppLog[], origin: string, storageUnavailable = false) {
  let host = "inne";
  try { const url = new URL(origin); if (["127.0.0.1", "localhost"].includes(url.hostname)) host = url.origin; } catch { /* No arbitrary URLs/query strings in reports. */ }
  const date = view.summary?.binding?.lastSuccessfulSyncAt;
  return JSON.stringify({
    application: "jewelry-workshop-demo", version, createdAt: new Date().toISOString(), origin: host,
    online: view.online, auth: !view.ready ? "restoring" : view.user ? "signed-in" : "signed-out",
    workspaceId: safeId(view.summary?.binding?.workspaceId) ?? null,
    lastSuccessfulSyncAt: date && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) ? date : null,
    pendingQuotes: view.summary?.pending ?? null, pendingPhotos: view.summary?.photoPending ?? null,
    quoteConflicts: view.summary?.conflicts.length ?? null, photoConflicts: view.summary?.photoConflicts.length ?? null,
    storageUnavailable, logs: logs.slice(0, 50).map(safeLog),
  }, null, 2);
}
