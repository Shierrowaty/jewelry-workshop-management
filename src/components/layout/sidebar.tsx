"use client";

import { UserPanel } from "@/features/account/user-panel";
import { Menu, X } from "lucide-react";
import { useRef, useState } from "react";
import { Brand } from "@/components/layout/brand";
import { Navigation } from "@/components/layout/navigation";

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <aside className="sidebar-surface relative z-20 flex flex-col text-sidebar-text lg:fixed lg:inset-y-0 lg:left-0 lg:w-72 lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-4 px-5 py-5 lg:px-7 lg:pb-12 lg:pt-10">
        <Brand />
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls="sidebar-navigation"
          aria-label={isOpen ? "Zamknij menu" : "Otwórz menu"}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-sidebar-line text-sidebar-text hover:bg-white/5 lg:hidden"
        >
          {isOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
        </button>
      </div>

      <div
        id="sidebar-navigation"
        onKeyDown={(event) => {
          if (event.key === "Escape" && isOpen) {
            setIsOpen(false);
            menuButtonRef.current?.focus();
          }
        }}
        className={`${isOpen ? "block" : "hidden"} px-4 pb-6 lg:block lg:px-5`}
      >
        <p className="mb-5 px-4 text-xs font-semibold tracking-[0.18em] text-sidebar-muted uppercase">
          Twoja pracownia
        </p>
        <Navigation onNavigate={() => setIsOpen(false)} />
      </div>

      <div className="mx-5 mt-auto border-t border-sidebar-line py-5 lg:mx-8 lg:py-7">
        <UserPanel />
        <div className="mb-3 h-px w-8 bg-gold-light/70" aria-hidden="true" />
        <p className="font-display text-xl text-sidebar-text">Pracownia złotnicza</p>
        <p className="mt-1.5 font-brand text-base tracking-normal text-sidebar-muted">Pracownia Demo</p>
      </div>
    </aside>
  );
}
