import type { Metadata } from 'next';
import { Manrope, Poppins, Lexend, Plus_Jakarta_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/providers/query-provider';
import { WalletProvider } from '@/providers/wallet-provider';
import { AuthProvider } from '@/providers/auth-provider';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

const lexend = Lexend({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-lexend',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ChainStrike — RWA Exchange',
  description: 'Trade compliant real-world asset tokens on Algorand',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${poppins.variable} ${lexend.variable} ${plusJakarta.variable} ${playfair.variable}`}>
      <body>
        <QueryProvider>
          <WalletProvider>
            <AuthProvider>{children}</AuthProvider>
          </WalletProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
