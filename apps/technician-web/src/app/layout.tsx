import type { Metadata, Viewport } from "next";
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
  title: "ClueXP Technician",
  description: "ClueXP field technician application",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", sizes: "1024x1024", type: "image/png" }
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png"
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ClueXP Tech"
  }
};

export const viewport: Viewport = {
  themeColor: "#ffbf00",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${archivo.variable} ${inter.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
