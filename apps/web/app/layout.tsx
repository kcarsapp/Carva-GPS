import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Carva GPS — Track anything, anywhere',
  description:
    'Modern GPS tracking for personal use, car rental, school bus, and logistics. Connect any GPS tracker. Web, iOS, and Android.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
