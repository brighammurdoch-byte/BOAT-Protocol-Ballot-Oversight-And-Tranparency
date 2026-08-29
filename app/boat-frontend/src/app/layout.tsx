import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import BoatWalletProvider from "../providers/BoatWalletProvider";

const display = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const sans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

const basePath = (process.env.BASE_PATH || "").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "BOAT — Ballot Oversight And Transparency",
  description:
    "Campus elections on Solana: create, vote, and independently verify tallies.",
  // Next static export does not always prefix metadata.manifest with basePath.
  manifest: `${basePath}/manifest.webmanifest`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col text-stone-900">
        <BoatWalletProvider>{children}</BoatWalletProvider>
      </body>
    </html>
  );
}
