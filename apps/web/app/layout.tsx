import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BRAND } from "@/lib/brand";
import { Providers } from "@/providers/providers";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: BRAND.title,
  description: BRAND.description,
  keywords: [...BRAND.keywords],
  applicationName: BRAND.name,
  openGraph: {
    title: BRAND.title,
    description: BRAND.description,
    siteName: BRAND.name,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: BRAND.title,
    description: BRAND.description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#120f1c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes sets the theme class before paint, so the server markup differs on purpose.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
