"use client";

import Link from "next/link";
import { useAppPathname } from "@/features/pwa/use-app-pathname";
import { navigationItems } from "@/config/navigation";

type NavigationProps = {
  onNavigate?: () => void;
};

export function Navigation({ onNavigate }: NavigationProps) {
  const pathname = useAppPathname();

  return (
    <nav aria-label="Menu główne">
      <ul className="space-y-2">
        {navigationItems.map(({ title, href, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={`group flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-sm leading-5 transition-colors motion-reduce:transition-none ${
                  isActive
                    ? "border-gold-light/25 bg-sidebar-active font-semibold text-gold-light shadow-[0_4px_18px_#0000000a]"
                    : "border-transparent text-sidebar-muted hover:bg-white/5 hover:text-sidebar-text"
                }`}
              >
                <Icon size={19} strokeWidth={1.65} className="shrink-0" aria-hidden="true" />
                <span>{title}</span>
                {isActive && (
                  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-gold-light" aria-hidden="true" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
