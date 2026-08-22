"use client"

import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences"
import { useStellar } from "@/components/web3-provider"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default function NotificationPreferencesPage() {
  const { address } = useStellar()

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 py-8 sm:px-6 lg:px-8 max-w-2xl">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
            <Link href="/dashboard/notifications">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to notifications
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Notification Preferences</h1>
          <p className="text-muted-foreground mt-1">
            Control which pool events trigger browser push notifications.
          </p>
        </div>

        <NotificationPreferencesPanel walletAddress={address} />
      </main>
    </div>
  )
}
