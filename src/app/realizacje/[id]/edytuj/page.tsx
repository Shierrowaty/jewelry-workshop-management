import type { Metadata } from "next";
import { exampleCatalog } from "@/features/quotes/catalog";
import { EditSavedQuote } from "@/features/quotes/edit-saved-quote";

export const metadata: Metadata = { title: "Edytuj realizację" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditSavedQuote key={id} id={id} catalog={exampleCatalog} />;
}
