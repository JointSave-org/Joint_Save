"use client"
import { useStellar } from "@/components/web3-provider"
import { redirect } from "next/navigation"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs"
import { BackToTop } from "@/components/ui/back-to-top"
import { useEffect } from "react"

export default function DashboardPage() {
  const { isConnected, isInitializing } = useStellar()
  useEffect(() => {
    if (!isInitializing && !isConnected) {
      redirect("/")
    }
  }, [isInitializing, isConnected])
  if (isInitializing || !isConnected) {
    return null
  }
  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <DashboardTabs />
      </main>
      <BackToTop />
    </div>
  )
}
