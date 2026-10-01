import { connection } from "next/server";
import { CalculatorEditor } from "@/features/calculator/calculator-editor";
import { getQuoteDate } from "@/features/quotes/defaults";
export const metadata = { title: "Kalkulator" };
export default async function CalculatorPage() { await connection(); return <CalculatorEditor initialDate={getQuoteDate(new Date())} />; }
