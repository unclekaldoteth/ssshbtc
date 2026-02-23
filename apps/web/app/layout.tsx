import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sssh BTC Wallet | Private BTC Wallet on Starknet",
  description:
    "Hackathon prototype for confidential BTC-denominated transfers on Starknet using ZK proofs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
