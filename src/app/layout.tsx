import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Painel de Vendas",
  description: "Vendas, anúncios e lucro em tempo real",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Painel", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0e1c22",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Figtree:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
