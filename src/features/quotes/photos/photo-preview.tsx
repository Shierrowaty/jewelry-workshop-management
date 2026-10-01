"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { PhotoImage } from "./photo-image";
import type { ActiveQuotePhoto } from "./types";

export function PhotoPreview({ photo, onClose }: { photo: ActiveQuotePhoto; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} aria-labelledby="photo-preview-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="m-auto w-[min(64rem,94vw)] max-w-none rounded-2xl border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70 sm:p-6">
    <header className="mb-4 flex items-center justify-between gap-4">
      <h2 id="photo-preview-title" className="min-w-0 break-words text-sm font-semibold">{photo.originalFileName}</h2>
      <button type="button" onClick={onClose} aria-label="Zamknij podgląd" className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line hover:bg-gold-soft"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="relative flex h-[min(70dvh,44rem)] items-center justify-center rounded-xl bg-black/5"><PhotoImage photo={photo} preview /></div>
    <p className="mt-3 text-xs text-muted">{photo.width} × {photo.height} px · Lokalna kopia zdjęcia</p>
  </dialog>;
}
