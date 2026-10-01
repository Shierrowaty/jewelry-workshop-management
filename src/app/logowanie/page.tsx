import type { Metadata } from "next";
import { LoginScreen } from "@/features/sync/login-screen";

export const metadata: Metadata = { title: "Konto i synchronizacja" };
export default function LoginPage() { return <LoginScreen />; }
