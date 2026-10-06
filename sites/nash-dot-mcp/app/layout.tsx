import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NASH Remote MCP",
  description: "Private NASH remote mailbox with owner-approved device pairing.",
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
