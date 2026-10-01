"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ActiveQuotePhoto } from "./types";

export function PhotoImage({ photo, preview = false }: { photo: ActiveQuotePhoto; preview?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo.blob);
    // Synchronize a browser-owned resource after commit and release it on every replacement/unmount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo.blob]);
  if (failed) return <span className="p-4 text-center text-xs text-red-800">Nie można wyświetlić zdjęcia. Spróbuj odświeżyć stronę.</span>;
  if (!url) return <span className="text-xs text-muted">Wczytywanie zdjęcia…</span>;
  return <Image src={url} alt={photo.originalFileName} fill unoptimized sizes={preview ? "90vw" : "(max-width: 640px) 50vw, 25vw"} className={preview ? "object-contain" : "object-cover"} onError={() => setFailed(true)} />;
}
