"use client"

import { useState } from "react"
import { Calendar, Clock, AlertTriangle, Edit2, Check, Sparkles } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"

interface ScheduleManagerProps {
  poolId: string
  contractAddress?: string
  isAdmin: boolean
  currentRoundDuration?: number // in seconds
  isCustomSchedule?: boolean
  currentRound?: number
  onScheduleUpdated?: () => void
}

export function ScheduleManager({
  poolId,
  isAdmin,
  currentRoundDuration = 604800, // default 7 days
  isCustomSchedule = false,
  currentRound = 0,
  onScheduleUpdated,
}: ScheduleManagerProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<string>("weekly")
  const [customValue, setCustomValue] = useState<number>(7)
  const [customUnit, setCustomUnit] = useState<"days" | "weeks" | "months">("days")
  const [customRoundDeadline, setCustomRoundDeadline] = useState<string>("")
  const [targetRound, setTargetRound] = useState<number>(currentRound + 1)
  const [loading, setLoading] = useState(false)

  // Compute duration in seconds based on preset or custom input
  const getComputedDurationSeconds = (): number => {
    switch (preset) {
      case "daily":
        return 86400
      case "weekly":
        return 604800
      case "biweekly":
        return 1209600
      case "monthly":
        return 2592000
      case "custom": {
        const unitMultiplier =
          customUnit === "days" ? 86400 : customUnit === "weeks" ? 604800 : 2592000
        return Math.max(86400, Math.min(31536000, customValue * unitMultiplier))
      }
      default:
        return 604800
    }
  }

  // Generate next 5 preview deadlines
  const getNextDeadlinesPreview = () => {
    const durationSec = getComputedDurationSeconds()
    const now = Date.now()
    const previews: { round: number; date: string }[] = []

    for (let i = 1; i <= 5; i++) {
      const rNum = currentRound + i
      const targetTime = now + durationSec * 1000 * i
      previews.push({
        round: rNum,
        date: new Date(targetTime).toLocaleDateString(undefined, {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      })
    }
    return previews
  }

  const handleSaveSchedule = async () => {
    try {
      setLoading(true)
      const durationSec = getComputedDurationSeconds()

      const response = await fetch(`/api/pools?id=${poolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule_config: {
            round_duration: durationSec,
            preset,
            is_custom: preset === "custom" || Boolean(customRoundDeadline),
            updated_at: new Date().toISOString(),
          },
          round_duration: durationSec,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to save schedule settings")
      }

      toast({
        title: "Schedule Updated",
        description: `Deposit schedule updated to ${durationSec / 86400} days for future rounds.`,
      })
      setOpen(false)
      if (onScheduleUpdated) onScheduleUpdated()
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update schedule",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) return null

  const daysCount = Math.round(currentRoundDuration / 86400)

  return (
    <Card className="border-teal-100 dark:border-teal-900 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            Contribution Schedule Manager
          </CardTitle>
          <CardDescription>
            Admin configuration for deposit frequency and upcoming round deadlines.
          </CardDescription>
        </div>
        <Badge variant={isCustomSchedule ? "secondary" : "outline"} className="capitalize">
          {isCustomSchedule ? "Custom Schedule" : `Every ${daysCount} Days`}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between p-3 rounded-lg bg-teal-50/50 dark:bg-teal-950/20 border border-teal-100 dark:border-teal-900/40">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Current Frequency
            </span>
            <p className="text-sm font-semibold text-foreground">
              {daysCount === 1
                ? "Daily"
                : daysCount === 7
                  ? "Weekly"
                  : daysCount === 14
                    ? "Biweekly"
                    : daysCount === 30
                      ? "Monthly"
                      : `Every ${daysCount} Days`}
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5">
                <Edit2 className="h-4 w-4" />
                Edit Schedule
              </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-teal-700 dark:text-teal-400">
                  <Sparkles className="h-5 w-5" />
                  Modify Deposit Schedule
                </DialogTitle>
                <DialogDescription>
                  Choose a preset frequency or specify custom date deadlines for future rounds.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-3">
                {/* Warning Banner */}
                <div className="flex items-start gap-2.5 p-3 text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Changing the schedule affects future rounds only. The current round deadline
                    remains unchanged.
                  </span>
                </div>

                {/* Preset Options */}
                <div className="space-y-2">
                  <Label>Frequency Preset</Label>
                  <Select value={preset} onValueChange={setPreset}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select preset" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily (Every 1 Day)</SelectItem>
                      <SelectItem value="weekly">Weekly (Every 7 Days)</SelectItem>
                      <SelectItem value="biweekly">Biweekly (Every 14 Days)</SelectItem>
                      <SelectItem value="monthly">Monthly (Every 30 Days)</SelectItem>
                      <SelectItem value="custom">Custom Duration</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom Mode Inputs */}
                {preset === "custom" && (
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/30">
                    <div className="space-y-1.5">
                      <Label htmlFor="customVal">Duration Value</Label>
                      <Input
                        id="customVal"
                        type="number"
                        min={1}
                        max={365}
                        value={customValue}
                        onChange={(e) => setCustomValue(parseInt(e.target.value) || 1)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Unit</Label>
                      <Select
                        value={customUnit}
                        onValueChange={(val: "days" | "weeks" | "months") => setCustomUnit(val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="days">Days</SelectItem>
                          <SelectItem value="weeks">Weeks</SelectItem>
                          <SelectItem value="months">Months</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Optional Custom Specific Round Deadline */}
                <div className="space-y-2 pt-2 border-t">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold">
                    <Calendar className="h-4 w-4 text-teal-600" />
                    Set Custom Deadline for Specific Round (Optional)
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="targetR" className="text-xs text-muted-foreground">
                        Round #
                      </Label>
                      <Input
                        id="targetR"
                        type="number"
                        min={currentRound + 1}
                        value={targetRound}
                        onChange={(e) =>
                          setTargetRound(parseInt(e.target.value) || currentRound + 1)
                        }
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="datePicker" className="text-xs text-muted-foreground">
                        Target Date & Time
                      </Label>
                      <Input
                        id="datePicker"
                        type="datetime-local"
                        value={customRoundDeadline}
                        onChange={(e) => setCustomRoundDeadline(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Next 5 Deadlines Preview */}
                <div className="space-y-2 pt-2">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Preview: Next 5 Computed Deadlines
                  </Label>
                  <div className="space-y-1 text-xs max-h-36 overflow-y-auto pr-1">
                    {getNextDeadlinesPreview().map((item) => (
                      <div
                        key={item.round}
                        className="flex items-center justify-between p-2 rounded bg-muted/40 border border-muted"
                      >
                        <span className="font-medium text-foreground">Round {item.round}</span>
                        <span className="text-muted-foreground">{item.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveSchedule}
                  disabled={loading}
                  className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
                >
                  <Check className="h-4 w-4" />
                  {loading ? "Saving..." : "Save Schedule"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  )
}
