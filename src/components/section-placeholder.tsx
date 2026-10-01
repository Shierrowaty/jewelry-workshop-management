import type { SectionDefinition } from "@/config/navigation";

export function SectionPlaceholder({ section }: { section: SectionDefinition }) {
  const Icon = section.icon;

  return (
    <section aria-labelledby="page-title">
      <div className="mb-8 flex items-center gap-5 sm:mb-10">
        <div>
          <span className="mb-4 block h-0.5 w-9 bg-gold" aria-hidden="true" />
          <h1 id="page-title" className="font-display text-4xl leading-tight font-medium tracking-tight text-ink sm:text-5xl">
            {section.title}
          </h1>
        </div>
      </div>

      <div className="placeholder-surface relative flex min-h-80 items-center justify-center overflow-hidden rounded-2xl border border-line px-6 py-16 sm:min-h-[25rem] sm:px-12">
        <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-transparent via-gold/45 to-transparent" aria-hidden="true" />
        <div className="relative flex max-w-md flex-col items-center text-center">
          <div className="mb-7 flex size-20 items-center justify-center rounded-2xl border border-gold/20 bg-gold-soft text-gold shadow-[0_4px_18px_#a17b2810]">
            <Icon size={31} strokeWidth={1.35} aria-hidden="true" />
          </div>
          <p className="text-base leading-7 text-muted">{section.description}</p>
          <div className="mt-8 flex items-center gap-2.5 text-gold/50" aria-hidden="true">
            <span className="h-px w-9 bg-current" />
            <span className="size-1 rotate-45 bg-current" />
            <span className="h-px w-9 bg-current" />
          </div>
        </div>
      </div>
    </section>
  );
}
