import type { Metadata } from "next";
import { connection } from "next/server";
import { sections } from "@/config/navigation";
import { exampleCatalog } from "@/features/quotes/catalog";
import { getQuoteDate } from "@/features/quotes/defaults";
import { QuoteForm } from "@/features/quotes/quote-form";

export const metadata: Metadata = { title: sections.newQuote.title };

export default async function NewQuotePage() {
  await connection();
  return <QuoteForm catalog={exampleCatalog} initialDate={getQuoteDate(new Date())} />;
}
