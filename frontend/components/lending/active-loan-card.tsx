"use client"

/**
 * ActiveLoanCard — displays an ACTIVE, REPAID, or DEFAULTED loan.
 *
 * Lender view:
 *  - Shows borrower address, outstanding balance, due date
 *  - "Mark as Defaulted" button (admin only, shown past due date)
 *
 * Borrower view:
 *  - Shows repayment progress bar
 *  - Repay form (partial or full amount)
 *  - Overdue warning badge
 */

import { useState } from "react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Loan } from "@/hooks/useMicroloans"
import {
  computeTotalOwed,
  computeRemaining,
  computeRepaymentProgress,
  formatDueDate,
  isOverdue,
  shortAddress,
} from "@/hooks/useMicroloans"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTokenAmount(stroops: bigint, decimals = 7): string {
  const divisor = BigInt(10 ** decimals)
  const whole = stroops / divisor
  const frac = stroops % divisor
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "")
  return fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`
}

function formatInterestRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

/** Parse a human-readable amount string into stroops (BigInt) */
function parseAmount(val: string, decimals = 7): bigint | null {
  const trimmed = val.trim()
  if (!trimmed || isNaN(Number(trimmed))) return null
  const [whole, frac = ""] = trimmed.split(".")
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0")
  try {
    return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded)
  } catch {
    return null
  }
}

// ── Status badge variants ─────────────────────────────────────────────────────

const STATUS_CONFIG = {
  Active: {
    label: "Active",
    badgeClass: "text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950/30",
  },
  Repaid: {
    label: "Repaid",
    badgeClass: "text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30",
  },
  Defaulted: {
    label: "Defaulted",
    badgeClass: "text-red-600 border-red-300 bg-red-50 dark:bg-red-950/30",
  },
  Pending: {
    label: "Pending",
    badgeClass: "text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30",
  },
  Cancelled: {
    label: "Cancelled",
    badgeClass: "text-muted-foreground border-border bg-muted/30",
  },
} as const

// ── Props ─────────────────────────────────────────────────────────────────────

interface ActiveLoanCardProps {
  loan: Loan
  /** Current connected wallet address */
  walletAddress: string | null | undefined
  /** Pool's token address — required for repay call */
  tokenAddress: string
  /** Whether the current wallet is the pool admin */
  isAdmin?: boolean
  /** Whether any mutation is in progress globally */
  isMutating: boolean
  /** Callback: borrower repays an amount */
  onRepay: (loanId: string, repayAmount: bigint, tokenAddress: string) => Promise<boolean>
  /** Callback: admin marks loan as defaulted */
  onDefault: (loanId: string) => Promise<boolean>
  className?: string
}

// ── Component ─────────────────────────────────────────────────name────────────

export function ActiveLoanCard({
  loan,
  walletAddress,
  tokenAddress,
  isAdmin = false,
  isMutating,
  onRepay,
  onDefault,
  className,
}: ActiveLoanCardProps) {
  const [repayDialogOpen, setRepayDialogOpen] = useState(false)
  const [defaultDialogOpen, setDefaultDialogOpen] = useState(false)
  const [repayInput, setRepayInput] = useState("")
  const [isRepaying, setIsRepaying] = useState(false)
  const [isDefaulting, setIsDefaulting] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)

  const isBorrower = !!walletAddress && loan.borrower.toLowerCase() === walletAddress.toLowerCase()

  const isLender =
    !!walletAddress && !!loan.lender && loan.lender.toLowerCase() === walletAddress.toLowerCase()

  const totalOwed = computeTotalOwed(loan)
  const remaining = computeRemaining(loan)
  const progress = computeRepaymentProgress(loan)
  const overdue = isOverdue(loan)
  const statusConfig = STATUS_CONFIG[loan.status] ?? STATUS_CONFIG.Active

  // Prefill repay input with full remaining amount when dialog opens
  const handleRepayDialogOpen = (open: boolean) => {
    if (open) {
      setRepayInput(formatTokenAmount(remaining))
      setInputError(null)
    }
    setRepayDialogOpen(open)
  }

  const handleRepayInputChange = (val: string) => {
    setRepayInput(val)
    setInputError(null)
    const parsed = parseAmount(val)
    if (parsed === null) {
      setInputError("Invalid amount")
    } else if (parsed <= 0n) {
      setInputError("Amount must be greater than 0")
    } else if (parsed > remaining) {
      setInputError(`Cannot exceed remaining balance (${formatTokenAmount(remaining)} XLM)`)
    }
  }

  const handleRepay = async () => {
    const parsed = parseAmount(repayInput)
    if (!parsed || parsed <= 0n || parsed > remaining) return
    setIsRepaying(true)
    try {
      const ok = await onRepay(loan.id, parsed, tokenAddress)
      if (ok) setRepayDialogOpen(false)
    } finally {
      setIsRepaying(false)
    }
  }

  const handleDefault = async () => {
    setIsDefaulting(true)
    try {
      const ok = await onDefault(loan.id)
      if (ok) setDefaultDialogOpen(false)
    } finally {
      setIsDefaulting(false)
    }
  }

  const canRepay = isBorrower && loan.status === "Active"
  const canDefault = isAdmin && loan.status === "Active" && overdue

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-shadow hover:shadow-md",
        overdue && loan.status === "Active" && "border-destructive/40",
        loan.status === "Repaid" && "border-green-300/50 opacity-80",
        loan.status === "Defaulted" && "border-red-400/50",
        className
      )}
    >
      {/* Status badge */}
      <div className="absolute top-3 right-3 flex gap-1.5">
        {overdue && loan.status === "Active" && (
          <Badge
            variant="outline"
            className="text-xs font-medium text-destructive border-destructive/40 bg-destructive/5"
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            Overdue
          </Badge>
        )}
        <Badge variant="outline" className={cn("text-xs font-medium", statusConfig.badgeClass)}>
          {statusConfig.label}
        </Badge>
      </div>

      <CardHeader className="pb-2 pt-4 px-4">
        {/* Parties */}
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Borrower</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-sm font-mono font-medium truncate cursor-default">
                  {shortAddress(loan.borrower)}
                  {isBorrower && <span className="ml-1 text-xs text-primary font-sans">(you)</span>}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-mono text-xs break-all max-w-xs">
                {loan.borrower}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex-1 min-w-0 text-right">
            <p className="text-xs text-muted-foreground">Lender</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-sm font-mono font-medium truncate cursor-default">
                  {shortAddress(loan.lender)}
                  {isLender && <span className="ml-1 text-xs text-primary font-sans">(you)</span>}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-mono text-xs break-all max-w-xs">
                {loan.lender ?? "—"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-3">
        {/* Amount row */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Principal</p>
            <p className="text-xl font-bold">{formatTokenAmount(loan.amount)} XLM</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total owed</p>
            <p className="text-sm font-semibold">{formatTokenAmount(totalOwed)} XLM</p>
          </div>
        </div>

        {/* Repayment progress */}
        {(loan.status === "Active" || loan.status === "Repaid") && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Repayment progress</span>
              <span className="font-medium text-foreground">{Math.round(progress)}%</span>
            </div>
            <Progress
              value={progress}
              className={cn(
                "h-2",
                loan.status === "Repaid" && "[&>div]:bg-green-500",
                overdue && loan.status === "Active" && "[&>div]:bg-destructive"
              )}
            />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                Repaid:{" "}
                <span className="text-foreground font-medium">
                  {formatTokenAmount(loan.repaidAmount)} XLM
                </span>
              </span>
              {loan.status === "Active" && (
                <span className="text-muted-foreground">
                  Remaining:{" "}
                  <span className="text-foreground font-medium">
                    {formatTokenAmount(remaining)} XLM
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

        <Separator />

        {/* Metadata grid */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="space-y-0.5">
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              <span className="text-xs">Rate</span>
            </div>
            <p className="text-sm font-semibold">{formatInterestRate(loan.interestRateBps)}</p>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="text-xs">Term</span>
            </div>
            <p className="text-sm font-semibold">{loan.termDays}d</p>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <Wallet className="h-3 w-3" />
              <span className="text-xs">Due</span>
            </div>
            <p className={cn("text-sm font-semibold", overdue && "text-destructive")}>
              {formatDueDate(loan.dueDate)}
            </p>
          </div>
        </div>

        {/* Repaid success message */}
        {loan.status === "Repaid" && (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-md px-3 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span>Fully repaid — reputation +10 points awarded</span>
          </div>
        )}

        {/* Defaulted warning */}
        {loan.status === "Defaulted" && (
          <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm">
            <ShieldAlert className="h-4 w-4 flex-shrink-0" />
            <span>Defaulted — borrower reputation −200 points</span>
          </div>
        )}
      </CardContent>

      {(canRepay || canDefault) && (
        <CardFooter className="px-4 pb-4 gap-2">
          {/* Repay button */}
          {canRepay && (
            <Dialog open={repayDialogOpen} onOpenChange={handleRepayDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="flex-1 gap-1.5" disabled={isMutating || isRepaying}>
                  {isRepaying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  )}
                  Make Repayment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Repay Loan</DialogTitle>
                  <DialogDescription>
                    Enter the amount you want to repay. You can make partial or full repayments. A
                    full repayment will award +10 reputation points.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  {/* Balance info */}
                  <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total owed</span>
                      <span className="font-medium">{formatTokenAmount(totalOwed)} XLM</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Already repaid</span>
                      <span className="font-medium">
                        {formatTokenAmount(loan.repaidAmount)} XLM
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Remaining balance</span>
                      <span>{formatTokenAmount(remaining)} XLM</span>
                    </div>
                  </div>

                  {/* Amount input */}
                  <div className="space-y-1.5">
                    <Label htmlFor="repay-amount">Repayment amount (XLM)</Label>
                    <Input
                      id="repay-amount"
                      type="number"
                      step="0.0000001"
                      min="0"
                      placeholder={`Max: ${formatTokenAmount(remaining)}`}
                      value={repayInput}
                      onChange={(e) => handleRepayInputChange(e.target.value)}
                      className={cn(inputError && "border-destructive")}
                    />
                    {inputError && <p className="text-xs text-destructive">{inputError}</p>}
                  </div>

                  {/* Quick-fill buttons */}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() => handleRepayInputChange(formatTokenAmount(remaining / 2n))}
                    >
                      50%
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() => handleRepayInputChange(formatTokenAmount(remaining))}
                    >
                      Full amount
                    </Button>
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setRepayDialogOpen(false)}
                    disabled={isRepaying}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRepay}
                    disabled={isRepaying || !!inputError || !repayInput || !parseAmount(repayInput)}
                    className="gap-1.5"
                  >
                    {isRepaying && <Loader2 className="h-4 w-4 animate-spin" />}
                    Submit Repayment
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {/* Default button — admin only, past due */}
          {canDefault && (
            <Dialog open={defaultDialogOpen} onOpenChange={setDefaultDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/5"
                  disabled={isMutating || isDefaulting}
                >
                  {isDefaulting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  Mark Defaulted
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Mark Loan as Defaulted?</DialogTitle>
                  <DialogDescription>
                    This loan is past its due date. Marking it as defaulted will apply a reputation
                    penalty of <strong>−200 points</strong> to the borrower (
                    <span className="font-mono">{shortAddress(loan.borrower)}</span>). This action
                    cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDefaultDialogOpen(false)}
                    disabled={isDefaulting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDefault}
                    disabled={isDefaulting}
                    className="gap-1.5"
                  >
                    {isDefaulting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Confirm Default
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
