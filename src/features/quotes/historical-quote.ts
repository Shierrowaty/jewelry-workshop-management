/** Compare with the day the record was entered, so ordinary quotes never age into historical entries. */
export function isHistoricalQuote(date: string, enteredDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{4}-\d{2}-\d{2}$/.test(enteredDate) && date < enteredDate;
}
