import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/section-placeholder";
import { sections } from "@/config/navigation";

export const metadata: Metadata = { title: sections.clients.title };

export default function ClientsPage() {
  return <SectionPlaceholder section={sections.clients} />;
}
