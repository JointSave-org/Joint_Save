"use client"

import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { Header } from "@/components/landing/header"
import { Footer } from "@/components/landing/footer"
import { ErrorBoundary } from "@/components/error-boundary"
import { SecuritySkeleton } from "@/components/ui/loading-skeletons"

const Security = dynamic(
  () => import("@/components/landing/security").then((mod) => mod.Security),
  {
    ssr: false,
    loading: () => <SecuritySkeleton />,
  }
)

export default function SecurityPage() {
  const t = useTranslations("legal")
  return (
    <ErrorBoundary sectionName={t("securityPageSection")}>
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 pt-16">
          <Security />
        </main>
        <Footer />
      </div>
    </ErrorBoundary>
  )
}
