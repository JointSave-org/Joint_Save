"use client"

import dynamic from "next/dynamic"
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
  return (
    <ErrorBoundary sectionName="Security Page">
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
