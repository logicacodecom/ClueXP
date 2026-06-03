import type { Metadata } from "next";
import { Archivo_Narrow, Inter } from "next/font/google";
import "./globals.css";

const archivo = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap"
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap"
});

export const metadata: Metadata = {
  title: "ClueXP Operations Console",
  description: "ClueXP dispatch operations console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${archivo.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
