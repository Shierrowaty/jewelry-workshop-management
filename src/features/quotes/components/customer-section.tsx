import { HistoricalQuoteBadge } from "./historical-quote-badge";
import { contactChannels, orderStatuses } from "../catalog";
import type { QuoteDraft } from "../types";
import { SelectField, TextareaField, TextField } from "./fields";
import { FormSection } from "./form-section";

type Customer = QuoteDraft["customer"];

export function CustomerSection({ value, enteredDate, onChange }: { value: Customer; enteredDate: string; onChange: (patch: Partial<Customer>) => void }) {
  return (
    <FormSection number="01" title="Klient i zamówienie">
      <TextField label="Imię i nazwisko" name="customerName" autoComplete="name" value={value.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="Wpisz dane klienta" />
      <TextField label="Pseudonim" name="customerNickname" value={value.nickname ?? ""} onChange={(event) => onChange({ nickname: event.target.value })} hint="Wystarczy imię i nazwisko lub pseudonim. Możesz podać oba." />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Kanał kontaktu" name="contactChannel" value={value.channel} onChange={(event) => onChange({ channel: event.target.value })}>
          <option value="">Wybierz kanał</option>
          {value.channel && !contactChannels.includes(value.channel) && <option>{value.channel}</option>}
          {contactChannels.map((channel) => <option key={channel}>{channel}</option>)}
        </SelectField>
        <TextField label="Dane kontaktowe" name="contactDetails" value={value.contact} onChange={(event) => onChange({ contact: event.target.value })} placeholder="Telefon, e-mail lub profil" />
        <TextField label="Data wyceny" hint="Możesz wpisać datę z przeszłości, aby dodać wycenę historyczną." name="quoteDate" type="date" value={value.quoteDate} onChange={(event) => onChange({ quoteDate: event.target.value })} />
        <TextField label="Termin wykonania" hint="Opcjonalnie — możesz uzupełnić później." name="dueDate" type="date" value={value.dueDate} onChange={(event) => onChange({ dueDate: event.target.value })} />
      </div>
      <HistoricalQuoteBadge date={value.quoteDate} enteredDate={enteredDate} />
      <SelectField label="Status" name="orderStatus" value={value.status} onChange={(event) => onChange({ status: event.target.value })}>
        {!orderStatuses.includes(value.status) && <option>{value.status}</option>}
        {orderStatuses.map((status) => <option key={status}>{status}</option>)}
      </SelectField>
      <TextareaField label="Uwagi" name="notes" rows={3} value={value.notes} onChange={(event) => onChange({ notes: event.target.value })} placeholder="Ustalenia, preferencje, ważne szczegóły…" />
    </FormSection>
  );
}
