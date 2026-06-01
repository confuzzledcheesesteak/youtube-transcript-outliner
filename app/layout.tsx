import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Transcript Outliner',
  description: 'Paste a YouTube URL and turn captions into timestamped outlines, section summaries, and clean study notes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
