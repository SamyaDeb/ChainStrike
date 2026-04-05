import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "ChainStrike | Decentralized Derivatives on Algorand",
  description:
    "Trade options and perpetuals with up to 20x leverage on Algorand. Non-custodial, transparent, and lightning fast.",
  keywords: [
    "algorand",
    "defi",
    "options",
    "perpetuals",
    "derivatives",
    "trading",
    "crypto",
    "blockchain",
  ],
  openGraph: {
    title: "ChainStrike | Decentralized Derivatives on Algorand",
    description:
      "Trade options and perpetuals with up to 20x leverage on Algorand.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ChainStrike | Decentralized Derivatives on Algorand",
    description:
      "Trade options and perpetuals with up to 20x leverage on Algorand.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans min-h-screen`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
