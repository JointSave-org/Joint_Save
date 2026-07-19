"use client"

import { use, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { RotationalForm } from "@/components/create-group/rotational-form"
import { TargetForm } from "@/components/create-group/target-form"
import { FlexibleForm } from "@/components/create-group/flexible-form"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

const validTypes = ["rotational", "target", "flexible"]

export interface DuplicatePrefill {
  name: string
  description: string
  /** Rotational: per-round contribution amount */
  amount: string
  /** Target pool: total savings goal */
  targetAmount: string
  /** Flexible pool: minimum deposit per transaction */
  minimumDeposit: string
  frequency: string
  members: string[]
  token: string
}

export default function CreateGroupPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params)
  const searchParams = useSearchParams()

  if (!validTypes.includes(type)) {
    redirect("/dashboard")
  }

  const prefill: DuplicatePrefill | undefined = useMemo(() => {
    if (!searchParams.get("duplicate")) return undefined
    try {
      const membersRaw = searchParams.get("members")
      const members = membersRaw ? JSON.parse(decodeURIComponent(membersRaw)) : []
      return {
        name: decodeURIComponent(searchParams.get("name") || ""),
        description: decodeURIComponent(searchParams.get("description") || ""),
        amount: searchParams.get("amount") || "",
        targetAmount: searchParams.get("targetAmount") || "",
        minimumDeposit: searchParams.get("minimumDeposit") || "",
        frequency: searchParams.get("frequency") || "",
        members,
        token: searchParams.get("token") || "XLM",
      }
    } catch {
      return undefined
    }
  }, [searchParams])

  const titles = {
    rotational: "Create Rotational Savings Group",
    target: "Create Target Pool Group",
    flexible: "Create Flexible Pool Group",
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-3xl mx-auto">
          <Button variant="ghost" className="mb-6" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>

          <Card className="p-8">
            <h1 className="text-3xl font-bold mb-2">
              {prefill ? `New Cycle: ${prefill.name}` : titles[type as keyof typeof titles]}
            </h1>
            <p className="text-muted-foreground mb-8">
              {prefill
                ? "Pre-filled from the original pool. Edit any values before creating."
                : "Fill in the details to create your savings group"}
            </p>

            {type === "rotational" && <RotationalForm prefill={prefill} />}
            {type === "target" && <TargetForm prefill={prefill} />}
            {type === "flexible" && <FlexibleForm prefill={prefill} />}
          </Card>
        </div>
      </main>
    </div>
  )
}
