import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pracownia Demo",
    template: "%s | Pracownia Demo",
  },
  description: "Demonstracyjna aplikacja do wycen i zarządzania pracownią jubilerską.",
  appleWebApp: { capable: true, title: "Pracownia Demo", statusBarStyle: "default" },
  icons: { apple: "/pwa/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#242823" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
