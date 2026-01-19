import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CodeCollab - Real-time Collaborative Code Editor",
  description:
    "A real-time collaborative code editor with voice chat, API testing, and AI debugging assistance. Built with Rust and Tauri.",
  keywords: [
    "code editor",
    "collaboration",
    "real-time",
    "rust",
    "tauri",
    "api testing",
  ],
  authors: [{ name: "CodeCollab Team" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#09090b" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#09090b] text-white overflow-hidden`}
      >
        {children}
      </body>
    </html>
  );
}
