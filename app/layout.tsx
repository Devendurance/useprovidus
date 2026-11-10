import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Baloo_2, Georama, VT323 } from "next/font/google";
import { cookieToInitialState } from "wagmi";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { wagmiConfig } from "@/lib/wallet/config";
import { PRODUCT_POSITIONING } from "@/lib/product/positioning";
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
  metadataBase: new URL("https://useprovidus.vercel.app"),
  title: {
    default: `Providus — ${PRODUCT_POSITIONING.tagline}`,
    template: "%s · Providus",
  },
  description:
    PRODUCT_POSITIONING.heroSupport,
  keywords: [
    "Providus",
    "Celo",
    "BOT Chain",
    "multichain payments",
    "conversational payments",
    "Nigerian payments",
    "airtime",
    "bank cash-out",
    "stablecoin",
  ],
  openGraph: {
    title: `Providus — ${PRODUCT_POSITIONING.tagline}`,
    description:
      PRODUCT_POSITIONING.heroSupport,
    url: "/",
    type: "website",
    images: [
      {
        url: "/brand/providus mascot full.png",
        width: 1254,
        height: 1254,
        alt: "Providus payment assistant mascot",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `Providus — ${PRODUCT_POSITIONING.tagline}`,
    description: PRODUCT_POSITIONING.heroSupport,
    images: ["/brand/providus mascot full.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#CBD2C4",
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
          <main
            id="main-content"
            tabIndex={-1}
            className="flex flex-1 flex-col outline-none"
          >
            {children}
          </main>
          <SiteFooter />
        </WalletProviders>
      </body>
    </html>
  );
}
