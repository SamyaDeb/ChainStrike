import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/providers/query-provider';
import { WalletProvider } from '@/providers/wallet-provider';

export const metadata: Metadata = {
  title: 'ChainStrike — RWA Exchange',
  description: 'Trade compliant real-world asset tokens on Algorand',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <WalletProvider>{children}</WalletProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
