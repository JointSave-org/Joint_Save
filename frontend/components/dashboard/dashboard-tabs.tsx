"use client"

import { useState, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MyGroups } from "@/components/dashboard/my-groups"
import { Explore } from "@/components/dashboard/explore"
import { CreateGroup } from "@/components/dashboard/create-group"
import { Transactions } from "@/components/dashboard/transactions"
import { Profile } from "@/components/dashboard/profile"
import { AnalyticsDashboard } from "@/components/dashboard/analytics"
import { Portfolio } from "@/components/dashboard/portfolio"
import { Home, PlusCircle, Receipt, User, TrendingUp, Compass, BarChart3 } from "lucide-react"

export function DashboardTabs({
  activeTab: controlledActiveTab,
  onTabChange,
}: {
  activeTab?: string
  onTabChange?: (tab: string) => void
}) {
  const [internalActiveTab, setInternalActiveTab] = useState("groups")
  const activeTab = controlledActiveTab ?? internalActiveTab
  const setActiveTab = onTabChange ?? setInternalActiveTab

  const handleCreateClick = useCallback(() => {
    setActiveTab("create")
  }, [])

  const tabValues = ["groups", "portfolio", "explore", "create", "transactions", "analytics", "profile"];
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const currentIndex = tabValues.indexOf(activeTab);
      const nextIndex = (currentIndex + 1) % tabValues.length;
      setActiveTab(tabValues[nextIndex]);
      document.getElementById(`tab-${tabValues[nextIndex]}`)?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const currentIndex = tabValues.indexOf(activeTab);
      const prevIndex = (currentIndex - 1 + tabValues.length) % tabValues.length;
      setActiveTab(tabValues[prevIndex]);
      document.getElementById(`tab-${tabValues[prevIndex]}`)?.focus();
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-7 mb-8" role="tablist" onKeyDown={handleKeyDown}>
        <TabsTrigger value="groups" className="flex items-center gap-2" role="tab" aria-selected={activeTab === "groups"} aria-controls="content-groups" id="tab-groups">
          <Home className="h-4 w-4" />
          <span className="hidden sm:inline">My Groups</span>
        </TabsTrigger>
        <TabsTrigger value="portfolio" className="flex items-center gap-2" role="tab" aria-selected={activeTab === "portfolio"} aria-controls="content-portfolio" id="tab-portfolio">
          <BarChart3 className="h-4 w-4" />
          <span className="hidden sm:inline">Portfolio</span>
        </TabsTrigger>
        <TabsTrigger value="explore" className="flex items-center gap-2" role="tab" aria-selected={activeTab === "explore"} aria-controls="content-explore" id="tab-explore">
          <Compass className="h-4 w-4" />
          <span className="hidden sm:inline">Explore</span>
        </TabsTrigger>
        <TabsTrigger value="create" className="flex items-center gap-2" role="tab" aria-selected={activeTab === "create"} aria-controls="content-create" id="tab-create">
          <PlusCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Create</span>
        </TabsTrigger>
        <TabsTrigger value="transactions" className="flex items-center gap-2" role="tab" aria-selected={activeTab === "transactions"} aria-controls="content-transactions" id="tab-transactions">
          <Receipt className="h-4 w-4" />
          <span className="hidden sm:inline">Transactions</span>
        </TabsTrigger>
        <TabsTrigger value="analytics" className="flex items-center gap-2" role="tab" aria-selected={activeTab === "analytics"} aria-controls="content-analytics" id="tab-analytics">
          <TrendingUp className="h-4 w-4" />
          <span className="hidden sm:inline">Analytics</span>
        </TabsTrigger>
        <TabsTrigger value="profile" className="flex items-center gap-2" role="tab" aria-selected={activeTab === "profile"} aria-controls="content-profile" id="tab-profile">
          <User className="h-4 w-4" />
          <span className="hidden sm:inline">Profile</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="groups" className="mt-0" id="content-groups">
        <MyGroups onCreateClick={handleCreateClick} />
      </TabsContent>

      <TabsContent value="portfolio" className="mt-0" id="content-portfolio">
        <Portfolio />
      </TabsContent>

      <TabsContent value="explore" className="mt-0" id="content-explore">
        <Explore />
      </TabsContent>

      <TabsContent value="create" className="mt-0" id="content-create">
        <CreateGroup />
      </TabsContent>

      <TabsContent value="transactions" className="mt-0" id="content-transactions">
        <Transactions />
      </TabsContent>

      <TabsContent value="analytics" className="mt-0" id="content-analytics">
        <AnalyticsDashboard />
      </TabsContent>

      <TabsContent value="profile" className="mt-0" id="content-profile">
        <Profile />
      </TabsContent>
    </Tabs>
  )
}
