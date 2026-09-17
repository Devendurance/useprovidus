import type { Metadata } from "next";
import { headers } from "next/headers";
import { Baloo_2, Georama, VT323 } from "next/font/google";
import { cookieToInitialState } from "wagmi";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { wagmiConfig } from "@/lib/wallet/config";
import "./globals.css";

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const georama = Georama({
  variable: "--font-georama",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: "400",
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
      className={`${baloo.variable} ${georama.variable} ${vt323.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-sage text-ink font-ui">
        <WalletProviders initialState={initialState}>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
        </WalletProviders>
      </body>
    </html>
  );
}
