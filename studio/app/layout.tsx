import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chordz — your expressive music studio",
  description:
    "Write, arrange, perform and finish your next song. An expressive browser studio with sampled orchestral instruments, synthesis and private projects.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
