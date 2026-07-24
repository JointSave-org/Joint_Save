"use client"

import React, { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TrendingUp, Coins, Loader2 } from "lucide-react"

interface YieldDashboardProps {
  deployedAmount?: number
  earnedYield?: number
  apy?: number
  onHarvest?: () => Promise<void>
}

export function YieldDashboard({
  deployedAmount = 0,
  earnedYield = 0,
  apy = 5.2,
  onHarvest,
}: YieldDashboardProps) {
  const [harvesting, setHarvesting] = useState(false)
  const [message, setMessage] = useState("")

  const canHarvest = earnedYield > 0 && deployedAmount > 0

  const handleHarvest = async () => {
    if (!canHarvest) return
    setHarvesting(true)
    setMessage("")
    try {
      if (onHarvest) {
        await onHarvest()
      }
      setMessage("Yield harvested successfully!")
    } catch {
      setMessage("Failed to harvest yield.")
    } finally {
      setHarvesting(false)
    }
  }

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Yield Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Automated DeFi Yield Generation on Stellar
          </p>
        </div>
        <div className="flex items-center gap-2 text-primary font-semibold">
          <TrendingUp className="h-5 w-5" />
          <span>{apy.toFixed(1)}% APY</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground">Deployed Capital</p>
          <p className="text-2xl font-bold" data-testid="deployed-amount">
            {deployedAmount.toFixed(2)} XLM
          </p>
        </div>
        <div className="p-4 rounded-lg bg-muted/30">
          <p className="text-sm text-muted-foreground">Earned Yield</p>
          <p className="text-2xl font-bold text-primary" data-testid="earned-yield">
            {earnedYield.toFixed(2)} XLM
          </p>
        </div>
      </div>

      {message && (
        <p
          className={`text-sm ${message.includes("success") ? "text-primary" : "text-destructive"}`}
        >
          {message}
        </p>
      )}

      <Button
        className="w-full bg-primary hover:bg-primary/90"
        disabled={!canHarvest || harvesting}
        onClick={handleHarvest}
      >
        {harvesting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Harvesting...
          </>
        ) : (
          <>
            <Coins className="mr-2 h-4 w-4" /> Harvest Yield
          </>
        )}
      </Button>
    </Card>
  )
}
