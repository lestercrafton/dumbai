import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './big-vin.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://big-vin-grind-to-win.sunlightisfree.chatgpt.site'),
  title: 'Big Vin | Grind to Win',
  description: 'Big Vin — independent sports lines, start-time and team search, live scores, ranked edges and visible results. Grind to Win.',
  openGraph: {
    type: 'website',
    siteName: 'Big Vin',
    title: 'Big Vin | Grind to Win',
    description: 'Our line. The Vegas line. A clearer view of the game.',
    images: [{url: '/big-vin-share.png', width: 1200, height: 630, alt: 'Big Vin — bv logo. An independent edge.'}],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Big Vin | Grind to Win',
    description: 'Our line. The Vegas line. A clearer view of the game.',
    images: [{url: '/big-vin-share.png', alt: 'Big Vin — bv logo. An independent edge.'}],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
