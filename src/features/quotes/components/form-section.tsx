import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export function FormSection({ number, title, description, children, embedded = false }: { embedded?: boolean; number: string; title: string; description?: string; children: ReactNode }) {
  if (embedded) return <div className="space-y-5">{children}</div>;
  return (
    <section aria-labelledby={`quote-section-${number}`} className="rounded-2xl border border-line bg-surface shadow-[0_5px_20px_#292c2903]">
      <header className="flex items-start gap-3.5 border-b border-line px-5 py-5 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-gold/15 bg-gold-soft text-sm font-semibold text-[#795b24]" aria-hidden="true">{number}</span>
        <div className="min-w-0 pt-0.5">
          <h2 id={`quote-section-${number}`} className="text-lg leading-7 font-semibold text-ink">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}
        </div>
      </header>
      <div className="space-y-5 p-5 sm:p-6">{children}</div>
    </section>
  );
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gold/25 bg-gold-soft px-4 py-2.5 text-sm font-semibold text-[#795b24] transition-colors hover:border-gold/50 hover:bg-gold/10">
      <Plus size={17} aria-hidden="true" />{children}
    </button>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-700">
      <Trash2 size={17} aria-hidden="true" />
    </button>
  );
}
