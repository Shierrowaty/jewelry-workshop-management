import { SyncStatus } from "@/features/sync/sync-status";
import { DiagnosticsPanel } from "@/features/diagnostics/diagnostics-panel";
export function Dashboard() {
  return <section aria-labelledby="page-title"><span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true"/><h1 id="page-title" className="font-display text-4xl font-medium text-ink sm:text-5xl">Pulpit</h1><p className="mt-3 text-sm leading-6 text-muted">Twoja pracownia. Dane zapisują się najpierw na tym urządzeniu.</p><div className="mt-8 grid items-start gap-6 xl:grid-cols-2"><SyncStatus/><DiagnosticsPanel/></div></section>;
}
