"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDataError } from "../data/storage";
import { getQuotePhotoRepository } from "./photo-repository";
import { PhotoError } from "./types";

export function photoErrorMessage(error: unknown) {
  return error instanceof PhotoError ? error.message : localDataError(error);
}

export function useQuotePhotos(quoteId: string) {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async () => {
    try {
      return { photos: await getQuotePhotoRepository().list(quoteId), error: null };
    } catch (error) {
      return { photos: undefined, error: photoErrorMessage(error) };
    }
  }, [quoteId, attempt]);
  return { result, retry: () => setAttempt((value) => value + 1) };
}
