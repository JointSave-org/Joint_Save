"use client"

import { useState, useEffect } from "react"
import { useStellar } from "@/components/web3-provider"
import { redirect } from "next/navigation"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs"
import { BackToTop } from "@/components/ui/back-to-top"
import { KeyboardShortcutsHelp } from "@/components/dashboard/keyboard-shortcuts-help"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { ErrorBoundary } from "@/components/error-boundary"

export default function DashboardPage() {
  const { isConnected, isInitializing, address } = useStellar()
  const [activeTab, setActiveTab] = useState("groups")
  const [showHelp, setShowHelp] = useState(false)

  useKeyboardShortcuts({
    onCreatePool: () => setActiveTab("create"),
    onGoToGroups: () => setActiveTab("groups"),
    onGoToPortfolio: () => setActiveTab("portfolio"),
    onGoToTransactions: () => setActiveTab("transactions"),
    onGoToProfile: () => setActiveTab("profile"),
    onOpenHelp: () => setShowHelp(true),
  })

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" })
  }, [activeTab])

  useEffect(() => {
    if (!isInitializing && !isConnected) {
      redirect("/")
    }
  }, [isInitializing, isConnected])
  if (isInitializing || !isConnected) {
    return null
  }

  return (
    <ErrorBoundary sectionName="Dashboard" walletAddress={address}>
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />
        </main>
        <BackToTop />
        <KeyboardShortcutsHelp open={showHelp} onOpenChange={setShowHelp} />
      </div>
    </ErrorBoundary>
  )
}
