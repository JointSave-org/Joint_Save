"use client"

/**
 * LendingTab — P2P microloan marketplace panel for a pool group page.
 *
 * Sections:
 *  1. "Create Loan Request" — form for pool members to request a loan
 *  2. "Loan Marketplace"   — pending requests from other members (lender view)
 *  3. "My Loans"           — active/repaid/defaulted loans for current user
 *
 * Visibility: only shown to verified pool members (isMember prop).
 * Mobile-responsive: stacked on small screens, grid on large.
 */

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  HandCoins,
  Info,
  Landmark,
  Loader2,
  PiggyBank,
  Plus,
  RefreshCw,
  WalletMinimal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useMicroloans, type Loan } from "@/hooks/useMicroloans"
import { LoanRequestCard } from "./loan-request-card"
import { ActiveLoanCard } from "./active-loan-card"

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateLoanForm(
  amount: string,
  rate: string,
  term: string
): Record<string, string> {
  const errors: Record<string, string> = {}

  const amtNum = parseFloat(amount)
  if (!amount || isNaN(amtNum) || amtNum <= 0) {
    errors.amount = "Enter a valid amount greater than 0"
  }

  const rateNum = parseFloat(rate)
  if (!rate || isNaN(rateNum) || rateNum < 0 || rateNum > 50) {
    errors.rate = "Rate must be between 0% and 50%"
  }

  const termNum = parseInt(term, 10)
  if (!term || isNaN(termNum) || termNum < 1 || termNum > 365) {
    errors.term = "Term must be between 1 and 365 days"
  }

  return errors
}

function parseAmountToStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".")
  const fracPadded = frac.slice(0, 7).padEnd(7, "0")
  return BigInt(whole || "0") * 10_000_000n + BigInt(fracPadded)
}

function rateToBps(rate: string): number {
  return Math.round(parseFloat(rate) * 100)
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function LendingTabSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

// ── Create Loan Form ──────────────────────────────────────────────────────────

interface CreateLoanFormProps {
  isMutating: boolean
  onSubmit: (amount: string, rate: string, term: string) => Promise<void>
}

function CreateLoanForm({ isMutating, onSubmit }: CreateLoanFormProps) {
  const [amount, setAmount] = useState("")
  const [rate, setRate] = useState("")
  const [term, setTerm] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationErrors = validateLoanForm(amount, rate, term)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})
    setIsSubmitting(true)
    try {
      await onSubmit(amount, rate, term)
      // Reset on success
      setAmount("")
      setRate("")
      setTerm("")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Request a Loan
        </CardTitle>
        <CardDescription>
          Post a loan request for other pool members to fund. Max 3 active loans per member.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="loan-amount">Amount (XLM)</Label>
            <Input
              id="loan-amount"
              type="number"
              step="0.0000001"
              min="0"
              placeholder="e.g. 100"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                if (errors.amount) setErrors((p) => ({ ...p, amount: "" }))
              }}
              className={cn(errors.amount && "border-destructive")}
            />
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount}</p>
            )}
          </div>

          {/* Rate + Term — side by side on sm+ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="loan-rate">Interest Rate (%)</Label>
              <Input
                id="loan-rate"
                type="number"
                step="0.01"
                min="0"
                max="50"
                placeholder="e.g. 5.0"
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value)
                  if (errors.rate) setErrors((p) => ({ ...p, rate: "" }))
                }}
                className={cn(errors.rate && "border-destructive")}
              />
              {errors.rate && (
                <p className="text-xs text-destructive">{errors.rate}</p>
              )}
              <p className="text-xs text-muted-foreground">0% – 50%</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loan-term">Term (days)</Label>
              <Input
                id="loan-term"
                type="number"
                step="1"
                min="1"
                max="365"
                placeholder="e.g. 30"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value)
                  if (errors.term) setErrors((p) => ({ ...p, term: "" }))
                }}
                className={cn(errors.term && "border-destructive")}
              />
              {errors.term && (
                <p className="text-xs text-destructive">{errors.term}</p>
              )}
              <p className="text-xs text-muted-foreground">1 – 365 days</p>
            </div>
          </div>

          {/* Preview */}
          {amount && rate && term && !Object.values(errors).some(Boolean) && (
            <div className="rounded-md bg-muted/40 border px-3 py-2 text-sm space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Loan preview
              </p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">You borrow</span>
                <span className="font-medium">{amount} XLM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">You repay</span>
                <span className="font-medium">
                  {(
                    parseFloat(amount) * (1 + parseFloat(rate) / 100)
                  ).toFixed(7)}{" "}
                  XLM
                </span>
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="w-full gap-1.5"
            disabled={isMutating || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <HandCoins className="h-4 w-4" />
            )}
            Post Loan Request
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2 text-muted-foreground">
      <Landmark className="h-8 w-8 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface LendingTabProps {
  /** Pool contract address (used as pool_id in the microloan contract) */
  poolId: string
  /** Pool token address for token transfers */
  tokenAddress: string
  /** Pool member addresses — validated for lending eligibility */
  poolMembers: string[]
  /** Whether the connected wallet is a member of this pool */
  isMember: boolean
  /** Whether the connected wallet is the pool admin */
  isAdmin?: boolean
  /** The connected wallet address */
  walletAddress: string | null | undefined
}

export function LendingTab({
  poolId,
  tokenAddress,
  poolMembers,
  isMember,
  isAdmin = false,
  walletAddress,
}: LendingTabProps) {
  const {
    poolLoans,
    myLoans,
    isLoading,
    isMutating,
    error,
    createLoanRequest,
    acceptLoan,
    repayLoan,
    cancelLoanRequest,
    defaultLoan,
    refetch,
  } = useMicroloans(isMember ? poolId : null)

  // Split loans by status for display
  const pendingLoans = poolLoans.filter((l) => l.status === "Pending")
  const activeLoans = myLoans.filter((l) => l.status === "Active")
  const historicalLoans = myLoans.filter(
    (l) => l.status === "Repaid" || l.status === "Defaulted"
  )

  // Pending count excluding own requests
  const fundableCount = pendingLoans.filter(
    (l) =>
      !walletAddress ||
      l.borrower.toLowerCase() !== walletAddress.toLowerCase()
  ).length

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleCreate = async (amount: string, rate: string, term: string) => {
    await createLoanRequest({
      poolId,
      amount: parseAmountToStroops(amount),
      interestRateBps: rateToBps(rate),
      termDays: parseInt(term, 10),
      poolMembers,
    })
  }

  const handleAccept = async (
    loanId: string,
    tokenAddr: string,
    members: string[]
  ): Promise<boolean> => {
    return acceptLoan({ loanId, tokenAddress: tokenAddr, poolMembers: members })
  }

  const handleRepay = async (
    loanId: string,
    repayAmount: bigint,
    tokenAddr: string
  ): Promise<boolean> => {
    return repayLoan({ loanId, repayAmount, tokenAddress: tokenAddr })
  }

  // ── Non-member wall ─────────────────────────────────────────────────────

  if (!isMember) {
    return (
      <Alert className="mt-2">
        <Info className="h-4 w-4" />
        <AlertTitle>Members only</AlertTitle>
        <AlertDescription>
          The lending marketplace is only visible to pool members.
          Join this pool to access peer-to-peer loans.
        </AlertDescription>
      </Alert>
    )
  }

  // ── Unconfigured state ──────────────────────────────────────────────────

  if (!process.env.NEXT_PUBLIC_MICROLOAN_CONTRACT_ID) {
    return (
      <Alert className="mt-2">
        <Info className="h-4 w-4" />
        <AlertTitle>Microloan contract not configured</AlertTitle>
        <AlertDescription>
          Set <code className="font-mono text-xs">NEXT_PUBLIC_MICROLOAN_CONTRACT_ID</code> in
          your environment variables to enable P2P lending.
        </AlertDescription>
      </Alert>
    )
  }

  if (isLoading) return <LendingTabSkeleton />

  if (error) {
    return (
      <Alert variant="destructive" className="mt-2">
        <AlertTitle>Failed to load loans</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-2">
          <span>{error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={refetch}
            className="flex-shrink-0 gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-primary" />
            P2P Lending
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Borrow from or lend to fellow pool members
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={refetch}
          disabled={isLoading || isMutating}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isMutating) && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Create loan request form */}
      <CreateLoanForm isMutating={isMutating} onSubmit={handleCreate} />

      <Separator />

      {/* Marketplace + My Loans tabs */}
      <Tabs defaultValue="marketplace" className="w-full">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="marketplace" className="flex-1 sm:flex-none gap-1.5">
            <Landmark className="h-3.5 w-3.5" />
            Marketplace
            {fundableCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
              >
                {fundableCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="my-loans" className="flex-1 sm:flex-none gap-1.5">
            <WalletMinimal className="h-3.5 w-3.5" />
            My Loans
            {activeLoans.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
              >
                {activeLoans.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Marketplace tab ────────────────────────────────────────────── */}
        <TabsContent value="marketplace" className="mt-4">
          {pendingLoans.length === 0 ? (
            <EmptyState message="No pending loan requests right now. Be the first to post one above." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {pendingLoans.map((loan) => (
                <LoanRequestCard
                  key={loan.id}
                  loan={loan}
                  walletAddress={walletAddress}
                  tokenAddress={tokenAddress}
                  poolMembers={poolMembers}
                  isMutating={isMutating}
                  onAccept={handleAccept}
                  onCancel={cancelLoanRequest}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── My Loans tab ────────────────────────────────────────────────── */}
        <TabsContent value="my-loans" className="mt-4 space-y-6">
          {/* Active */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Active Loans
            </h3>
            {activeLoans.length === 0 ? (
              <EmptyState message="You have no active loans." />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeLoans.map((loan) => (
                  <ActiveLoanCard
                    key={loan.id}
                    loan={loan}
                    walletAddress={walletAddress}
                    tokenAddress={tokenAddress}
                    isAdmin={isAdmin}
                    isMutating={isMutating}
                    onRepay={handleRepay}
                    onDefault={defaultLoan}
                  />
                ))}
              </div>
            )}
          </div>

          {/* History */}
          {historicalLoans.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Loan History
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {historicalLoans.map((loan) => (
                    <ActiveLoanCard
                      key={loan.id}
                      loan={loan}
                      walletAddress={walletAddress}
                      tokenAddress={tokenAddress}
                      isAdmin={isAdmin}
                      isMutating={isMutating}
                      onRepay={handleRepay}
                      onDefault={defaultLoan}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {myLoans.length === 0 && (
            <EmptyState message="You haven't borrowed or lent anything yet." />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
