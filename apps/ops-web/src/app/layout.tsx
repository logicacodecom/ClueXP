import type { Metadata } from "next";
import { Archivo_Narrow, Inter } from "next/font/google";
import "@cluexp/console-ui/console.css";

const condensed = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-condensed",
  display: "swap"
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap"
});

export const metadata: Metadata = {
  title: "ClueXP Operations Console",
  description: "ClueXP dispatch operations console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${condensed.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
