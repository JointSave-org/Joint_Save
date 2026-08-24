"use client"

/**
 * LoanRequestCard — displays a single PENDING loan request in the marketplace.
 *
 * Shows:
 *  - Borrower address (shortened)
 *  - Requested amount, interest rate, term
 *  - Total repayment if accepted
 *  - "Fund This Loan" button (hidden for own requests; disabled while mutating)
 *  - "Cancel Request" button for the borrower's own requests
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Loader2, HandCoins, X, Clock, TrendingUp, Calendar } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Loan } from "@/hooks/useMicroloans"
import { computeTotalOwed, shortAddress } from "@/hooks/useMicroloans"

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a stroops value (7 decimal places) to a human-friendly string */
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

// ── Props ─────────────────────────────────────────────────────────────────────

interface LoanRequestCardProps {
  loan: Loan
  /** Current connected wallet address */
  walletAddress: string | null | undefined
  /** Pool's token address — required to call accept_loan */
  tokenAddress: string
  /** All pool member addresses — passed to the accept call */
  poolMembers: string[]
  /** Whether any mutation is in progress globally (disables all buttons) */
  isMutating: boolean
  /** Callback after user confirms acceptance */
  onAccept: (loanId: string, tokenAddress: string, poolMembers: string[]) => Promise<boolean>
  /** Callback after user confirms cancellation */
  onCancel: (loanId: string) => Promise<boolean>
  /** Optional extra class name */
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LoanRequestCard({
  loan,
  walletAddress,
  tokenAddress,
  poolMembers,
  isMutating,
  onAccept,
  onCancel,
  className,
}: LoanRequestCardProps) {
  const t = useTranslations("lending.card")
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [isAccepting, setIsAccepting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const isOwnRequest =
    !!walletAddress && loan.borrower.toLowerCase() === walletAddress.toLowerCase()

  const totalOwed = computeTotalOwed(loan)
  const netEarnings = totalOwed - loan.amount // lender's expected interest income

  const handleAccept = async () => {
    setIsAccepting(true)
    try {
      const ok = await onAccept(loan.id, tokenAddress, poolMembers)
      if (ok) setAcceptDialogOpen(false)
    } finally {
      setIsAccepting(false)
    }
  }

  const handleCancel = async () => {
    setIsCancelling(true)
    try {
      const ok = await onCancel(loan.id)
      if (ok) setCancelDialogOpen(false)
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-shadow hover:shadow-md",
        isOwnRequest && "border-primary/30 bg-primary/5",
        className
      )}
    >
      {/* Pending badge */}
      <div className="absolute top-3 right-3">
        <Badge
          variant="outline"
          className="text-xs font-medium text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30"
        >
          {t("pending")}
        </Badge>
      </div>

      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start gap-3">
          {/* Avatar placeholder */}
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-mono font-semibold text-muted-foreground">
            {loan.borrower.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground leading-tight">{t("borrower")}</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-sm font-medium font-mono truncate cursor-default">
                  {shortAddress(loan.borrower)}
                  {isOwnRequest && (
                    <span className="ml-2 text-xs text-primary font-sans">{t("you")}</span>
                  )}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-mono text-xs break-all max-w-xs">
                {loan.borrower}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-3">
        {/* Principal amount — large display */}
        <div className="text-center py-2">
          <p className="text-2xl sm:text-3xl font-bold tracking-tight">
            {formatTokenAmount(loan.amount)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("xlmRequested")}</p>
        </div>

        <Separator />

        {/* Key metrics grid */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="space-y-0.5">
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              <span className="text-xs">{t("rate")}</span>
            </div>
            <p className="text-sm font-semibold">{formatInterestRate(loan.interestRateBps)}</p>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span className="text-xs">{t("term")}</span>
            </div>
            <p className="text-sm font-semibold">{loan.termDays}d</p>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="text-xs">{t("return")}</span>
            </div>
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              +{formatTokenAmount(netEarnings)}
            </p>
          </div>
        </div>

        {/* Total repayment row */}
        <div className="flex justify-between items-center text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
          <span>{t("totalRepayment")}</span>
          <span className="font-medium text-foreground">{formatTokenAmount(totalOwed)} XLM</span>
        </div>
      </CardContent>

      <CardFooter className="px-4 pb-4 gap-2 flex-wrap">
        {/* Fund button — hidden for own requests */}
        {!isOwnRequest && (
          <Dialog open={acceptDialogOpen} onOpenChange={setAcceptDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="flex-1 min-w-0 gap-1.5"
                disabled={isMutating || isAccepting}
              >
                {isAccepting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <HandCoins className="h-3.5 w-3.5" />
                )}
                {t("fundThisLoan")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("confirmFundingTitle")}</DialogTitle>
                <DialogDescription>
                  {t.rich("confirmFundingDesc", {
                    strong: (chunks) => <strong>{chunks}</strong>,
                    amount: formatTokenAmount(loan.amount),
                    borrower: <span className="font-mono">{shortAddress(loan.borrower)}</span>,
                    days: loan.termDays,
                    rate: formatInterestRate(loan.interestRateBps),
                  })}
                </DialogDescription>
              </DialogHeader>

              {/* Funding summary */}
              <div className="rounded-md border bg-muted/30 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("youLend")}</span>
                  <span className="font-medium">{formatTokenAmount(loan.amount)} XLM</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("youReceiveBack")}</span>
                  <span className="font-medium">{formatTokenAmount(totalOwed)} XLM</span>
                </div>
                <Separator />
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>{t("yourEarnings")}</span>
                  <span className="font-semibold">+{formatTokenAmount(netEarnings)} XLM</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("dueDate")}</span>
                  <span className="font-medium">{t("dueDateValue", { days: loan.termDays })}</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{t("fundingNote")}</p>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setAcceptDialogOpen(false)}
                  disabled={isAccepting}
                >
                  {t("cancel")}
                </Button>
                <Button onClick={handleAccept} disabled={isAccepting} className="gap-1.5">
                  {isAccepting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("confirmFunding")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Cancel button — only for borrower's own pending requests */}
        {isOwnRequest && (
          <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 min-w-0 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/5"
                disabled={isMutating || isCancelling}
              >
                {isCancelling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                {t("cancelRequest")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("cancelRequestTitle")}</DialogTitle>
                <DialogDescription>
                  {t.rich("cancelRequestDesc", {
                    strong: (chunks) => <strong>{chunks}</strong>,
                    amount: formatTokenAmount(loan.amount),
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCancelDialogOpen(false)}
                  disabled={isCancelling}
                >
                  {t("keepRequest")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="gap-1.5"
                >
                  {isCancelling && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("yesCancel")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardFooter>
    </Card>
  )
}
