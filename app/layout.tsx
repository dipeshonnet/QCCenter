import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Northstar Quality OS',
  description: 'A modern command center for operational quality, audits, analytics, and corrective action.',
  openGraph: {
    title: 'Northstar Quality OS',
    description: 'See quality clearly. Act with confidence.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Northstar Quality OS' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Northstar Quality OS',
    description: 'See quality clearly. Act with confidence.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
