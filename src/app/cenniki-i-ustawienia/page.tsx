import type { Metadata } from "next";
import { KnowledgeBase } from "@/features/knowledge/knowledge-base";
import { sections } from "@/config/navigation";

export const metadata: Metadata = { title: sections.settings.title };

export default function SettingsPage() {
  return <KnowledgeBase />;
}
