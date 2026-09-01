import type { Metadata } from "next";
import { headers } from "next/headers";
import { DM_Sans, Inter, IBM_Plex_Mono } from "next/font/google";
import { cookieToInitialState } from "wagmi";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { wagmiConfig } from "@/lib/wallet/config";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Providus — Know what arrives before you pay",
    template: "%s · Providus",
  },
  description:
    "The Celo route-intelligence agent for smarter on-ramp decisions. Compare local routes into Celo by what you actually receive after fees, FX, limits and settlement time.",
  keywords: [
    "Providus",
    "Celo",
    "route intelligence",
    "on-ramp",
    "cUSD",
    "stablecoin",
    "fees",
    "FX",
  ],
  openGraph: {
    title: "Providus — Know what arrives before you pay",
    description:
      "The Celo route-intelligence agent for smarter on-ramp decisions.",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const initialState = cookieToInitialState(
    wagmiConfig,
    headerStore.get("cookie"),
  );

  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-receipt-field text-ledger-stone">
        <WalletProviders initialState={initialState}>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
        </WalletProviders>
      </body>
    </html>
  );
}
