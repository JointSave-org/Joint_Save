import { Toaster } from "@/components/ui/toaster"
import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Web3Provider } from "@/components/web3-provider"
import { PoolDataProvider } from "@/lib/data-layer/PoolDataProvider"
import "@/lib/env"
import { ThemeProvider } from "@/components/theme-provider"
import { Suspense } from "react"

export const metadata: Metadata = {
  title: "JointSave — Decentralized Community Savings on Stellar",
  description:
    "A decentralized community savings platform built on Stellar that enables groups to pool, save, and grow funds together.",
  icons: {
    icon: "/icon.png",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "JointSave — Decentralized Community Savings on Stellar",
    description:
      "A decentralized community savings platform built on Stellar that enables groups to pool, save, and grow funds together.",
    images: ["/opengraph-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "JointSave — Decentralized Community Savings on Stellar",
    description:
      "A decentralized community savings platform built on Stellar that enables groups to pool, save, and grow funds together.",
    images: ["/opengraph-image.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <Suspense fallback={null}>
            <Web3Provider>
              <PoolDataProvider>{children}</PoolDataProvider>
            </Web3Provider>
          </Suspense>
        </ThemeProvider>
        <Analytics />
        <Toaster />
      </body>
    </html>
  )
}
