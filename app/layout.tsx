import type { Metadata, Viewport } from "next";
import { brand } from "@/lib/branding";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(brand.appUrl),
  title: {
    default: `${brand.productName} — Book a meeting with ${brand.name}`,
    template: `%s · ${brand.productName}`,
  },
  description: brand.description,
  applicationName: brand.productName,
  authors: [{ name: brand.legalName, url: brand.websiteUrl }],
  creator: brand.legalName,
  publisher: brand.legalName,
  openGraph: {
    type: "website",
    url: brand.appUrl,
    title: brand.productName,
    description: brand.description,
    siteName: brand.productName,
  },
  twitter: {
    card: "summary_large_image",
    title: brand.productName,
    description: brand.description,
  },
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: brand.colors.primary,
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
