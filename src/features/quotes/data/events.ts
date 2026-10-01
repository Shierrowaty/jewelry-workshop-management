// Optional observers run only after the local transaction has committed.
export function notifyQuoteSaved() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("quotes:saved-locally"));
}
