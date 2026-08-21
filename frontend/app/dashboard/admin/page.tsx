"use client"

import dynamic from "next/dynamic"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { ErrorBoundary } from "@/components/error-boundary"
import { AdminDashboardSkeleton } from "@/components/ui/loading-skeletons"
import { useStellar } from "@/components/web3-provider"

const AdminAuditLog = dynamic(
  () => import("@/components/group/admin-audit-log").then((mod) => mod.AdminAuditLog),
  { ssr: false, loading: () => <AdminDashboardSkeleton /> }
)

const AdminActionsLog = dynamic(
  () => import("@/components/group/admin-actions-log").then((mod) => mod.AdminActionsLog),
  { ssr: false, loading: () => <AdminDashboardSkeleton /> }
)

export default function AdminDashboardPage() {
  const { address } = useStellar()

  return (
    <ErrorBoundary sectionName="Admin Dashboard">
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
            <p className="text-muted-foreground">
              Review pool audit logs, administrative actions, and governance history.
            </p>
          </div>

          <div className="space-y-6">
            {address && <AdminAuditLog creatorAddress={address} />}
            <AdminActionsLog />
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}
