import { PwaStatus } from "@/features/pwa/pwa-status";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Sidebar } from "@/components/layout/sidebar";
import { SyncProvider } from "@/features/sync/sync-provider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SyncProvider><div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only fixed top-4 left-4 z-50 rounded-lg bg-ink px-5 py-3 text-white focus:not-sr-only"
      >
        Przejdź do treści
      </a>
      <Sidebar />
      <div className="flex min-h-dvh flex-col lg:ml-72">
        <PageHeader />
        <PwaStatus />
        <main id="main-content" tabIndex={-1} className="flex-1 px-6 py-9 outline-none sm:px-10 sm:py-12 lg:px-12">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div></SyncProvider>
  );
}
