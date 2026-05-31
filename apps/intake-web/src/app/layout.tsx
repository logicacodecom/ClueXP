import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClueXP Emergency Access",
  description: "Emergency physical access intake"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
