import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AppProviders } from "@/providers/app-providers";
import { Navigation } from "@/components/navigation";
import { selectedCooketChainName } from "@/lib/chain";

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://cooket.fun"),
  title: "Cooket | Arc Testnet development",
  description: `Cooket is an Arc-native token launch protocol in testnet development on ${selectedCooketChainName}.`,
  icons: { icon: "/brand/cooket-icon.png", apple: "/brand/cooket-icon.png", shortcut: "/brand/cooket-icon.png" },
  openGraph: { type: "website", url: "https://cooket.fun", siteName: "Cooket", title: "Cooket | Arc Testnet development", description: "Cooket is an Arc-native token launch protocol in testnet development.", images: [{ url: "/brand/cooket-og.png", width: 1200, height: 630, alt: "Cooket" }] },
  twitter: { card: "summary_large_image", title: "Cooket | Arc Testnet development", description: "Cooket is an Arc-native token launch protocol in testnet development.", images: ["/brand/cooket-og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const cookieHeader = (await headers()).get("cookie");
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col"><AppProviders cookies={cookieHeader}><Navigation />{children}</AppProviders></body>
    </html>
  );
}
