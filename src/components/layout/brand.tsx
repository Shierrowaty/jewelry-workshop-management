import { Gem } from "lucide-react";
import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      aria-label="Pracownia Demo — pulpit"
      className="inline-flex items-center gap-3.5 rounded-lg text-sidebar-text"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-sidebar-line text-gold-light">
        <Gem size={23} strokeWidth={1.35} aria-hidden="true" />
      </span>
      <span className="font-brand text-[1.625rem] leading-[1.1] tracking-normal">
        Pracownia
        <br />
        <span className="text-gold-light">Demo</span>
      </span>
    </Link>
  );
}
