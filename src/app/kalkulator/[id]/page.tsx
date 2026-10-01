import { EditCalculation } from "@/features/calculator/saved-calculations";
export const metadata = { title: "Edytuj kalkulację" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <EditCalculation id={id} />; }
