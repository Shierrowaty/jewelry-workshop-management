import type { Metadata } from "next";
import { SavedQuoteDetails } from "@/features/quotes/saved-quote-details";

export const metadata: Metadata = { title: "Szczegóły wyceny" };

export default async function QuoteDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SavedQuoteDetails key={id} id={id} />;
}
