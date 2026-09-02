import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://hearu-listen-together.akshaey2007.chatgpt.site'),
  title: 'HearU — Listen together',
  description: 'A liquid-glass mobile experience for sharing local music with friends in perfect sync.',
  openGraph: {
    title: 'HearU — Listen together',
    description: 'Share local music with friends in a beautifully synchronized listening room.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HearU — Listen together' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HearU — Listen together',
    description: 'Share local music with friends in a beautifully synchronized listening room.',
    images: ['/og.png'],
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
