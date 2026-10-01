"use client";

import { ChevronRight, Gem } from "lucide-react";
import { useAppPathname } from "@/features/pwa/use-app-pathname";
import { navigationItems } from "@/config/navigation";

export function PageHeader() {
  const pathname = useAppPathname();
  const currentSection = navigationItems.find((item) => item.href === pathname || (item.href !== "/" && pathname.startsWith(`${item.href}/`)));

  return (
    <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/75 px-6 py-5 sm:px-10 lg:px-12">
      <div className="flex min-w-0 items-center gap-2.5 text-sm">
        <span className="text-muted">Pracownia</span>
        <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
        <span className="font-medium text-ink">{pathname === "/logowanie" ? "Konto i synchronizacja" : currentSection?.title ?? "Nie znaleziono strony"}</span>
      </div>
      <div className="hidden items-center gap-2.5 text-muted xl:flex">
        <Gem size={15} strokeWidth={1.5} className="text-gold" aria-hidden="true" />
        <span className="font-brand text-base tracking-normal">Pracownia Demo</span>
      </div>
    </header>
  );
}
