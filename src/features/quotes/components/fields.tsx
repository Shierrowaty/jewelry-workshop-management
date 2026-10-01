import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const controlClass = "min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2.5 text-base leading-6 text-ink shadow-xs transition-colors placeholder:text-muted/65 hover:border-gold/45 focus:border-gold focus:outline-2 focus:outline-gold/20 focus:outline-offset-0 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted aria-invalid:border-red-500";

type FieldInfo = { label: string; hint?: string; error?: string };

function FieldFrame({ id, label, hint, error, children }: FieldInfo & { id: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-sm font-medium leading-5 text-ink">{label}</label>
      {children}
      {(hint || error) && (
        <p id={`${id}-help`} className={`mt-1.5 text-xs leading-5 ${error ? "text-red-700" : "text-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, hint, error, unit, ...props }: FieldInfo & InputHTMLAttributes<HTMLInputElement> & { unit?: string }) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input {...props} id={id} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-help` : undefined} className={`${controlClass} ${unit ? "pr-14 tabular-nums" : ""}`} />
        {unit && <span className="pointer-events-none absolute top-3 right-3 text-sm leading-6 text-muted" aria-hidden="true">{unit}</span>}
      </div>
    </FieldFrame>
  );
}

export function NumericField(props: FieldInfo & InputHTMLAttributes<HTMLInputElement> & { unit?: string }) {
  return <TextField type="text" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={32} placeholder="0,00" {...props} />;
}

export function SelectField({ label, hint, error, children, ...props }: FieldInfo & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <select {...props} id={id} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-help` : undefined} className={controlClass}>
        {children}
      </select>
    </FieldFrame>
  );
}

export function TextareaField({ label, hint, error, ...props }: FieldInfo & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <textarea {...props} id={id} aria-describedby={hint || error ? `${id}-help` : undefined} className={`${controlClass} resize-y`} />
    </FieldFrame>
  );
}

export function CheckboxField({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm leading-5 text-ink">
      <input {...props} type="checkbox" className="size-4 shrink-0 accent-gold" />
      <span>{label}</span>
    </label>
  );
}
