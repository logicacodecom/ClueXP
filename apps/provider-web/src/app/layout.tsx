import type { Metadata } from "next";
import "@cluexp/console-ui/console.css";

export const metadata: Metadata = {
  title: "ClueXP Provider Console",
  description: "ClueXP organization dispatch console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
