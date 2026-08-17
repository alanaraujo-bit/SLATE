import type { Metadata, Viewport } from "next";
import { RegistrarServiceWorker } from "@/components/registrar-service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLATE",
  description:
    "Superfície de controle inteligente e contextual para o seu computador.",
  applicationName: "SLATE",
  appleWebApp: {
    capable: true,
    title: "SLATE",
    // A barra de status transparente deixa o conteúdo ir até o topo; o
    // preenchimento de área segura no CSS é o que impede o texto de ficar
    // embaixo do relógio.
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // Sem isto, o iOS transforma números que parecem telefone em links no meio
    // dos controles.
    telephone: false,
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  // A PWA é uma ferramenta pessoal ligada a um computador específico: não há
  // nada aqui que faça sentido num resultado de busca.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#08090f",
  width: "device-width",
  initialScale: 1,
  // Cobre a área do entalhe em vez de deixar barras pretas nas laterais.
  viewportFit: "cover",
  // Zoom continua permitido: bloquear seria excluir quem precisa ampliar para
  // enxergar, e o custo de um zoom acidental é menor que o de não conseguir ler.
  userScalable: true,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <RegistrarServiceWorker />
        {children}
      </body>
    </html>
  );
}
