"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MyGroups } from "@/components/dashboard/my-groups"
import { Explore } from "@/components/dashboard/explore"
import { CreateGroup } from "@/components/dashboard/create-group"
import { Portfolio } from "@/components/dashboard/portfolio"
import { Profile } from "@/components/dashboard/profile"
import { Home, PlusCircle, Receipt, User, TrendingUp, Compass, BarChart3 } from "lucide-react"
import { TransactionsSkeleton, AnalyticsSkeleton } from "@/components/ui/loading-skeletons"

// Heavy components lazy loaded on demand
const Transactions = dynamic(
  () => import("@/components/dashboard/transactions").then((mod) => mod.Transactions),
  { ssr: false, loading: () => <TransactionsSkeleton /> }
)

const AnalyticsDashboard = dynamic(
  () => import("@/components/dashboard/analytics").then((mod) => mod.AnalyticsDashboard),
  { ssr: false, loading: () => <AnalyticsSkeleton /> }
)

export function DashboardTabs({
  activeTab: controlledActiveTab,
  onTabChange,
}: {
  activeTab?: string
  onTabChange?: (tab: string) => void
}) {
  const t = useTranslations("dashboard.tabs")
  const [internalActiveTab, setInternalActiveTab] = useState("groups")
  const activeTab = controlledActiveTab ?? internalActiveTab
  const setActiveTab = onTabChange ?? setInternalActiveTab

  const handleCreateClick = useCallback(() => {
    setActiveTab("create")
  }, [setActiveTab])

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-7 mb-8">
        <TabsTrigger value="groups" className="flex items-center gap-2">
          <Home className="h-4 w-4" />
          <span className="hidden sm:inline">{t("groups")}</span>
        </TabsTrigger>
        <TabsTrigger value="portfolio" className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          <span className="hidden sm:inline">{t("portfolio")}</span>
        </TabsTrigger>
        <TabsTrigger value="explore" className="flex items-center gap-2">
          <Compass className="h-4 w-4" />
          <span className="hidden sm:inline">{t("explore")}</span>
        </TabsTrigger>
        <TabsTrigger value="create" className="flex items-center gap-2">
          <PlusCircle className="h-4 w-4" />
          <span className="hidden sm:inline">{t("create")}</span>
        </TabsTrigger>
        <TabsTrigger value="transactions" className="flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          <span className="hidden sm:inline">{t("transactions")}</span>
        </TabsTrigger>
        <TabsTrigger value="analytics" className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          <span className="hidden sm:inline">{t("analytics")}</span>
        </TabsTrigger>
        <TabsTrigger value="profile" className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span className="hidden sm:inline">{t("profile")}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="groups" className="mt-0">
        <MyGroups onCreateClick={handleCreateClick} />
      </TabsContent>

      <TabsContent value="portfolio" className="mt-0">
        <Portfolio />
      </TabsContent>

      <TabsContent value="explore" className="mt-0">
        <Explore />
      </TabsContent>

      <TabsContent value="create" className="mt-0">
        <CreateGroup />
      </TabsContent>

      <TabsContent value="transactions" className="mt-0">
        <Transactions />
      </TabsContent>

      <TabsContent value="analytics" className="mt-0">
        <AnalyticsDashboard />
      </TabsContent>

      <TabsContent value="profile" className="mt-0">
        <Profile />
      </TabsContent>
    </Tabs>
  )
}
