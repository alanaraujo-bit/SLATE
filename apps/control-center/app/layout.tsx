import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLATE — Centro de Controle de Desenvolvimento",
  description:
    "Estado de engenharia do SLATE by Aionix em tempo real: fases, marcos, critérios de qualidade, execução atual e ações do operador.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
