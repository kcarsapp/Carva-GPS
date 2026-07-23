import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Carva Fleet — Real-time AI Fleet Tracking",
  description:
    "Track every vehicle live, catch safety risks before they happen, and cut fuel costs with AI-powered fleet management.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
