import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/section-placeholder";
import { sections } from "@/config/navigation";

export const metadata: Metadata = { title: sections.calendar.title };

export default function CalendarPage() {
  return <SectionPlaceholder section={sections.calendar} />;
}
