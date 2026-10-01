"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getQuoteRepository } from "./quote-repository";
import { localDataError } from "./storage";

async function readResult<T>(read: () => Promise<T>) {
  try {
    return { data: await read(), error: null };
  } catch (error) {
    return { data: undefined, error: localDataError(error) };
  }
}

export function useLocalQuotes() {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(() => readResult(() => getQuoteRepository().list()), [attempt]);
  return { result, retry: () => setAttempt((value) => value + 1) };
}

export function useLocalQuote(id: string) {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(() => readResult(() => getQuoteRepository().get(id)), [id, attempt]);
  return { result, retry: () => setAttempt((value) => value + 1) };
}
