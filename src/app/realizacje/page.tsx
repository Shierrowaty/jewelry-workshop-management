import type { Metadata } from "next";
import { SavedQuotesList } from "@/features/quotes/saved-quotes-list";
import { sections } from "@/config/navigation";

export const metadata: Metadata = { title: sections.projects.title };

export default function ProjectsPage() {
  return <SavedQuotesList />;
}
