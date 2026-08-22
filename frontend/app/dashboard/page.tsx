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
import { OnboardingProvider, useOnboarding } from "@/hooks/useOnboarding"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
import { OnboardingChecklist } from "@/components/onboarding/onboarding-checklist"

function DashboardContent() {
  const { isConnected, isInitializing, address } = useStellar()
  const { showWizard, skip } = useOnboarding()
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
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:p-4 focus:bg-background focus:text-foreground">
        Skip to main content
      </a>
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main id="main-content" className="container mx-auto px-4 sm:px-6 lg:px-8 py-8" tabIndex={-1}>
          <h1 className="sr-only">JointSave Dashboard</h1>
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
            {/* Onboarding checklist sidebar (hidden on mobile, collapsible) */}
            <aside className="hidden lg:block sticky top-20">
              <OnboardingChecklist />
            </aside>
            <div className="min-w-0">
              <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />
            </div>
          </div>
        </main>
        <BackToTop />
        <KeyboardShortcutsHelp open={showHelp} onOpenChange={setShowHelp} />
        {/* First-visit onboarding wizard */}
        <OnboardingWizard open={showWizard} onClose={skip} />
      </div>
    </ErrorBoundary>
  )
}

export default function DashboardPage() {
  return (
    <OnboardingProvider>
      <DashboardContent />
    </OnboardingProvider>
  )
}
