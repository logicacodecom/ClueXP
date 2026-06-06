import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

const archivo = localFont({
  src: "../../../../packages/console-ui/src/fonts/archivo-narrow-latin.woff2",
  variable: "--font-archivo",
  display: "swap",
  weight: "400 700"
});

const inter = localFont({
  src: "../../../../packages/console-ui/src/fonts/inter-latin.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "400 700"
});

export const metadata: Metadata = {
  title: "ClueXP Provider Console",
  description: "ClueXP organization dispatch console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${archivo.variable} ${inter.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
