"use client"

import { useEffect, useState } from "react"
import { Clock, ArrowRight, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface DeadlineCountdownProps {
  targetTimestamp: number // in seconds or milliseconds
  hasDeposited?: boolean
  onDepositClick?: () => void
}

export function DeadlineCountdown({
  targetTimestamp,
  hasDeposited = false,
  onDepositClick,
}: DeadlineCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number
    hours: number
    minutes: number
    seconds: number
    totalSeconds: number
  }>({ days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 })

  useEffect(() => {
    const targetMs =
      targetTimestamp > 1e11 ? targetTimestamp : targetTimestamp * 1000

    const updateTimer = () => {
      const now = Date.now()
      const diffMs = Math.max(0, targetMs - now)
      const totalSec = Math.floor(diffMs / 1000)

      const days = Math.floor(totalSec / 86400)
      const hours = Math.floor((totalSec % 86400) / 3600)
      const minutes = Math.floor((totalSec % 3600) / 60)
      const seconds = totalSec % 60

      setTimeLeft({ days, hours, minutes, seconds, totalSeconds: totalSec })
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [targetTimestamp])

  const totalHours = timeLeft.totalSeconds / 3600
  const isImminent = totalHours > 0 && totalHours <= 24
  const isUrgent = totalHours > 0 && totalHours <= 6

  // Color progression: Green (>24h) -> Yellow/Amber (6-24h) -> Red (<6h)
  const getBadgeColor = () => {
    if (timeLeft.totalSeconds === 0) return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
    if (isUrgent) return "bg-red-500 text-white dark:bg-red-600"
    if (isImminent) return "bg-amber-500 text-white dark:bg-amber-600"
    return "bg-emerald-500 text-white dark:bg-emerald-600"
  }

  const getContainerStyles = () => {
    if (timeLeft.totalSeconds === 0)
      return "border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30"
    if (isUrgent)
      return "border-red-300 dark:border-red-900 bg-red-50/60 dark:bg-red-950/40 text-red-950 dark:text-red-100"
    if (isImminent)
      return "border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100"
    return "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100"
  }

  return (
    <Card className={`border shadow-sm transition-all duration-300 ${getContainerStyles()}`}>
      <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Timer section */}
        <div className="flex items-center gap-3.5">
          <div
            className={`p-2.5 rounded-full ${
              isImminent ? "animate-pulse" : ""
            } ${
              isUrgent
                ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300"
                : isImminent
                ? "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300"
            }`}
          >
            <Clock className="h-6 w-6" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Next Deposit Deadline
              </span>
              {isImminent && (
                <Badge className={`text-[10px] px-1.5 py-0 font-bold ${getBadgeColor()} ${isUrgent ? "animate-pulse" : ""}`}>
                  {isUrgent ? "URGENT" : "IMMINENT"}
                </Badge>
              )}
            </div>

            {timeLeft.totalSeconds === 0 ? (
              <p className="text-base font-semibold text-muted-foreground">Round deadline reached</p>
            ) : (
              <div className="flex items-baseline gap-2 mt-0.5">
                <div className="flex items-center gap-1 text-2xl font-bold tracking-tight">
                  <span>{String(timeLeft.days).padStart(2, "0")}</span>
                  <span className="text-xs font-normal text-muted-foreground">d</span>
                  <span className="text-muted-foreground/60">:</span>
                  <span>{String(timeLeft.hours).padStart(2, "0")}</span>
                  <span className="text-xs font-normal text-muted-foreground">h</span>
                  <span className="text-muted-foreground/60">:</span>
                  <span>{String(timeLeft.minutes).padStart(2, "0")}</span>
                  <span className="text-xs font-normal text-muted-foreground">m</span>
                  <span className="text-muted-foreground/60">:</span>
                  <span>{String(timeLeft.seconds).padStart(2, "0")}</span>
                  <span className="text-xs font-normal text-muted-foreground">s</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Deposit Status & Action */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          {hasDeposited ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-3 py-1.5 rounded-full border border-emerald-300 dark:border-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              Deposited for this round
            </div>
          ) : (
            <Button
              onClick={onDepositClick}
              className={`w-full sm:w-auto font-semibold gap-1.5 shadow-sm ${
                isUrgent
                  ? "bg-red-600 hover:bg-red-700 text-white animate-bounce"
                  : isImminent
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }`}
            >
              Deposit Now
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
