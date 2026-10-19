import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './big-vin.css';
import './fiji-theme.css';
import './playbook.css';
import HostingNotice from '@/components/hosting-notice';

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
  icons: {
    icon: [{url: '/bv-icon.svg', type: 'image/svg+xml'}, {url: '/bv-icon-32.png', sizes: '32x32', type: 'image/png'}],
    apple: [{url: '/bv-apple-touch.png', sizes: '180x180', type: 'image/png'}],
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Big Vin',
    title: 'Big Vin | Grind to Win',
    description: 'Our line. The Vegas line. A clearer view of the game.',
    images: [{url: '/big-vin-share-v2.png', width: 1200, height: 630, type: 'image/png', alt: 'Big Vin — original bv logo. An independent edge.'}],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Big Vin | Grind to Win',
    description: 'Our line. The Vegas line. A clearer view of the game.',
    images: [{url: '/big-vin-share-v2.png', alt: 'Big Vin — original bv logo. An independent edge.'}],
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
        <HostingNotice />
        {children}
      </body>
    </html>
  );
}
