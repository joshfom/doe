import type { Metadata } from "next";
import { Geist_Mono, Public_Sans, Poppins } from "next/font/google";
import { urwGeometric } from "./fonts/urw-geometric";
import "./globals.css";

// ORA brand secondary typeface (Public Sans, free, Google Fonts).
// Retained as a fallback CSS variable for legacy usages; the primary brand
// typeface is now URW Geometric, self-hosted via next/font/local. See
// `.kiro/specs/branded-font-enforcement/design.md` §2 for the wiring.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Poppins — used for the admin panel (ora-panel) UI.
// The frontend visitor-facing pages use URW Geometric (brand font).
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ORA",
    template: "%s | ORA",
  },
  description: "ORA Content Management Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${urwGeometric.variable} ${publicSans.variable} ${poppins.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
