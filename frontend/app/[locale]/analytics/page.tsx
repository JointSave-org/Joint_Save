"use client"

import dynamic from "next/dynamic"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { ErrorBoundary } from "@/components/error-boundary"
import { AnalyticsSkeleton } from "@/components/ui/loading-skeletons"

const AnalyticsDashboard = dynamic(
  () => import("@/components/dashboard/analytics").then((mod) => mod.AnalyticsDashboard),
  {
    ssr: false,
    loading: () => <AnalyticsSkeleton />,
  }
)

export default function AnalyticsPage() {
  return (
    <ErrorBoundary sectionName="Analytics Page">
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <AnalyticsDashboard />
        </main>
      </div>
    </ErrorBoundary>
  )
}
