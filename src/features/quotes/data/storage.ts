import { logsFor } from "../../diagnostics/logs";
import { getLocalDatabase } from "./database";
import { InvalidQuoteError, QuoteConflictError, QuoteNotFoundError } from "./quote-repository";

export function localDataError(error: unknown): string {
  if (error instanceof InvalidQuoteError || error instanceof QuoteConflictError || error instanceof QuoteNotFoundError) return error.message;
  if (typeof window !== "undefined") void logsFor(getLocalDatabase()).record("database", error);
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return "Brak miejsca na lokalny zapis. Zwolnij miejsce na urządzeniu i spróbuj ponownie. Nie czyść danych tej aplikacji.";
  if (name === "SecurityError" || name === "MissingAPIError") return "Przeglądarka blokuje lokalną bazę. Zezwól tej witrynie na przechowywanie danych i spróbuj ponownie.";
  return "Nie udało się uzyskać dostępu do lokalnej bazy. Spróbuj ponownie. Nie zamykaj formularza z niezapisanymi zmianami.";
}

// Best effort protection against browser eviction; failure never invalidates a committed save.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
