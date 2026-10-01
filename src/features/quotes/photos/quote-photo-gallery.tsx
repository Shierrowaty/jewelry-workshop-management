"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import { LocalDataError } from "../components/local-data-state";
import { requestPersistentStorage } from "../data/storage";
import { useUnsavedChanges } from "../use-unsaved-changes";
import { getQuotePhotoRepository } from "./photo-repository";
import { preparePhoto } from "./prepare-photo";
import { photoErrorMessage, useQuotePhotos } from "./use-quote-photos";
import { PhotoImage } from "./photo-image";
import { PhotoPreview } from "./photo-preview";
import { PhotoSyncNotice } from "../../sync/photos/photo-sync-notice";
import type { ActiveQuotePhoto } from "./types";

export function QuotePhotoGallery({ quoteId }: { quoteId: string }) {
  const { result, retry } = useQuotePhotos(quoteId);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const photos = result?.photos;
  const selected = photos?.find((photo) => photo.id === selectedId);
  useUnsavedChanges(busy);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function addPhotos(files: File[]) {
    if (inFlight.current || !files.length) return;
    inFlight.current = true;
    setBusy(true);
    setErrors([]);
    void requestPersistentStorage();
    let saved = 0;
    const failures: string[] = [];
    try {
      // Decode and save sequentially, so a batch of phone photos doesn't fill memory.
      for (const [index, file] of files.entries()) {
        if (!mounted.current) break;
        setMessage(`Przygotowywanie i zapisywanie zdjęcia ${index + 1} z ${files.length}…`);
        try {
          const prepared = await preparePhoto(file);
          if (!mounted.current) break;
          await getQuotePhotoRepository().add(quoteId, prepared);
          saved++;
        } catch (error) {
          failures.push(`${file.name}: ${photoErrorMessage(error)}`);
        }
      }
      if (mounted.current) {
        setMessage(`Zapisano lokalnie zdjęcia: ${saved} z ${files.length}.`);
        setErrors(failures);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function removePhoto(photo: ActiveQuotePhoto) {
    if (inFlight.current || !window.confirm(`Usunąć zdjęcie „${photo.originalFileName}” z tej realizacji? Usunięcie zapisze się lokalnie, a po synchronizacji obejmie także pozostałe urządzenia pracowni. Oryginalny plik na dysku pozostanie bez zmian.`)) return;
    inFlight.current = true;
    setBusy(true);
    setErrors([]);
    setMessage("Usuwanie zdjęcia…");
    try {
      await getQuotePhotoRepository().remove(quoteId, photo.id);
      if (mounted.current) setMessage("Zdjęcie zostało usunięte z lokalnej galerii.");
    } catch (error) {
      if (mounted.current) { setErrors([photoErrorMessage(error)]); setMessage(""); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section aria-labelledby="quote-photos-title" className="mb-6 rounded-2xl border border-line bg-surface shadow-[0_5px_20px_#292c2903]">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5 sm:px-6">
      <div className="flex items-center gap-3.5">
        <span className="flex size-10 items-center justify-center rounded-xl border border-gold/15 bg-gold-soft text-[#795b24]"><Camera size={20} aria-hidden="true" /></span>
        <div><h2 id="quote-photos-title" className="text-lg font-semibold text-ink">Zdjęcia realizacji</h2><p className="mt-1 text-xs text-muted">{photos ? `Zdjęcia: ${photos.length}` : "Lokalna galeria"}</p></div>
      </div>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="Wybierz zdjęcia realizacji" className="hidden" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        void addPhotos(files);
      }} />
      <button type="button" disabled={busy || !photos} onClick={() => input.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gold/25 bg-gold-soft px-4 py-2.5 text-sm font-semibold text-[#795b24] hover:bg-gold/10 disabled:cursor-wait disabled:opacity-50"><Plus size={17} aria-hidden="true" />Dodaj zdjęcia</button>
    </header>
    <div className="space-y-4 p-5 sm:p-6">
      <p className="text-xs leading-5 text-muted">Opcjonalna dokumentacja realizacji. JPEG, PNG lub WebP. Duże zdjęcia zmniejszamy przed lokalnym zapisem; oryginalne pliki pozostają bez zmian.</p>
      <PhotoSyncNotice quoteId={quoteId} />
      {!result && <p role="status" className="text-sm text-muted">Wczytywanie zdjęć…</p>}
      {result?.error && <LocalDataError message={result.error} onRetry={retry} />}
      {photos?.length === 0 && <div className="rounded-xl border border-dashed border-line bg-gold-soft/30 px-5 py-7 text-center"><p className="text-sm font-medium text-ink">Jeszcze bez zdjęć</p><p className="mt-2 text-sm text-muted">Dodaj zdjęcie projektu, detalu lub gotowej realizacji. Możesz wrócić do tego później.</p></div>}
      {!!photos?.length && <ul aria-label="Galeria zdjęć realizacji" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo) => <li key={photo.id} className="min-w-0 overflow-hidden rounded-xl border border-line">
          <button type="button" aria-label={`Otwórz zdjęcie: ${photo.originalFileName}`} onClick={() => setSelectedId(photo.id)} className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-gold-soft focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-gold"><PhotoImage photo={photo} /></button>
          <div className="flex items-center gap-1 py-1 pr-1 pl-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-ink" title={photo.originalFileName}>{photo.originalFileName}</p><p className="mt-1 text-[11px] text-muted">{Math.max(1, Math.round(photo.size / 1024))} KB · {photo.syncStatus === "synced" ? "zsynchronizowano" : photo.syncStatus === "conflict" ? "konflikt" : "oczekuje na sync"}</p></div>
            <button type="button" disabled={busy} aria-label={`Usuń zdjęcie: ${photo.originalFileName}`} onClick={() => void removePhoto(photo)} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700 disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
          </div>
        </li>)}
      </ul>}
      {message && <p role="status" className="text-sm text-ink">{message}</p>}
      {errors.length > 0 && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p className="font-semibold">Nie wszystkie operacje się powiodły.</p><ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((error, index) => <li key={index} className="break-words">{error}</li>)}</ul><p className="mt-3">Zapisane zdjęcia i wycena pozostają bez zmian. Możesz spróbować ponownie.</p></div>}
    </div>
    {selected && <PhotoPreview photo={selected} onClose={() => setSelectedId(null)} />}
  </section>;
}
