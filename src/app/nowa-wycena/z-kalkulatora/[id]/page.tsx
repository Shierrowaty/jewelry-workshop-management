import { QuoteFromCalculator } from "@/features/calculator/quote-from-calculator";
export const metadata = { title: "Nowa wycena — szkic z kalkulatora" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <QuoteFromCalculator id={id} />; }
