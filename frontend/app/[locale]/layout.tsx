import type React from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/toaster"
import { Web3Provider } from "@/components/web3-provider"
import { PoolDataProvider } from "@/lib/data-layer/PoolDataProvider"
import { ThemeProvider } from "@/components/theme-provider"
import { ReactQueryProvider } from "@/components/react-query-provider"
import { Suspense } from "react"
import { TxQueueBadge } from "@/components/tx-queue-badge"
import { ScrollToTop } from "@/components/ui/scroll-to-top"
import { TransactionRecoveryProvider } from "@/components/transaction-recovery-provider"
import { PendingTxBanner } from "@/components/shared/pending-tx-banner"
import { WebVitals } from "@/components/web-vitals"
import { routing } from "@/i18n/routing"
import type { Locale } from "@/i18n/routing"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "metadata" })
  const title = t("title")
  const description = t("description")

  return {
    title,
    description,
    icons: {
      icon: "/icon.png",
      shortcut: "/favicon.ico",
      apple: "/apple-touch-icon.png",
    },
    openGraph: {
      title,
      description,
      images: ["/opengraph-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image.png"],
    },
  }
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale as Locale)
  const messages = await getMessages()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ReactQueryProvider>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <ScrollToTop />
          <Suspense fallback={null}>
            <Web3Provider>
              <TransactionRecoveryProvider>
                <PoolDataProvider>
                  {children}
                  <PendingTxBanner />
                </PoolDataProvider>
              </TransactionRecoveryProvider>
            </Web3Provider>
          </Suspense>
        </ThemeProvider>
      </ReactQueryProvider>
      <Analytics />
      <WebVitals />
      <Toaster />
      <TxQueueBadge />
    </NextIntlClientProvider>
  )
}
