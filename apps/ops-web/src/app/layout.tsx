import type { Metadata } from "next";
import "@cluexp/console-ui/console.css";

export const metadata: Metadata = {
  title: "ClueXP Operations Console",
  description: "ClueXP dispatch operations console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
