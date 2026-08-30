"use client"

import { use, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useStellar } from "@/components/web3-provider"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  Users,
  Wallet,
  Clock,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  Check,
  TrendingUp,
  Sparkles,
} from "lucide-react"
import { Link } from "@/i18n/navigation"
import { motion } from "framer-motion"

interface GroupData {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: string
  description: string | null
  total_saved: number
  target_amount: number | null
  progress: number
  members_count: number
  created_at: string
  contribution_amount: number | null
  minimum_deposit?: number | null
  frequency: string | null
  deadline: string | null
  contract_address: string
  token_symbol?: string
  token_decimals?: number
  creator_address?: string
  pool_members?: { member_address: string }[]
}

export default function JoinPage({ params }: { params: Promise<{ contractId: string }> }) {
  const t = useTranslations("join")
  const tPool = useTranslations("pool")
  const { contractId } = use(params)
  const { address, connect, isConnected } = useStellar()
  const { toast } = useToast()

  const { data, isLoading, error } = usePoolData(contractId)
  const group = (data?.db ?? null) as GroupData | null

  const [requestStatus, setRequestStatus] = useState<string | null>(null)
  const [loadingRequest, setLoadingRequest] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [copiedCreator, setCopiedCreator] = useState(false)

  // Fetch existing request status if connected and group exists
  useEffect(() => {
    if (!address || !group?.id) {
      setRequestStatus(null)
      return
    }
    setLoadingRequest(true)
    fetch(`/api/join-requests?poolId=${group.id}&requester=${address}`)
      .then((res) => {
        if (!res.ok) throw new Error(t("fetchRequestsError"))
        return res.json()
      })
      .then((data) => {
        if (data && data.length > 0) {
          setRequestStatus(data[0].status) // 'pending' | 'accepted' | 'declined'
        } else {
          setRequestStatus("none")
        }
      })
      .catch(() => setRequestStatus("none"))
      .finally(() => setLoadingRequest(false))
  }, [address, group?.id])

  const handleRequestJoin = async () => {
    if (!group || !address) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolId: group.id, requesterAddress: address }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || t("fetchSendError"))
      }
      toast({
        title: t("toastRequestSentTitle"),
        description: t("toastRequestSentBody"),
      })
      setRequestStatus("pending")
    } catch (err) {
      toast({
        title: t("toastErrorTitle"),
        description: err instanceof Error ? err.message : t("toastErrorGeneric"),
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyCreator = async () => {
    if (!group?.creator_address) return
    try {
      await navigator.clipboard.writeText(group.creator_address)
      setCopiedCreator(true)
      toast({
        title: t("toastCopiedTitle"),
        description: t("toastCopiedBody"),
      })
      setTimeout(() => setCopiedCreator(false), 2000)
    } catch {
      toast({
        title: t("toastCopyFailedTitle"),
        description: t("toastCopyFailedBody"),
        variant: "destructive",
      })
    }
  }

  // Helper check if already member
  const isAlreadyMember =
    !!address &&
    !!group &&
    group.pool_members?.some((m) => m.member_address.toLowerCase() === address.toLowerCase())

  // Loading state skeleton
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 py-16 max-w-xl">
          <Card className="p-6 space-y-6">
            <div className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </Card>
        </main>
      </div>
    )
  }

  // Error / Not Found / 404 state
  if (error || !group) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <DashboardHeader />
        <main className="flex-1 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md"
          >
            <Card className="border-destructive/30 bg-destructive/5 text-center p-6 shadow-xl">
              <CardHeader className="flex flex-col items-center pb-2">
                <AlertCircle className="h-12 w-12 text-destructive mb-2" />
                <CardTitle className="text-2xl font-bold text-destructive">
                  {t("poolNotFoundTitle")}
                </CardTitle>
                <CardDescription className="text-muted-foreground mt-2">
                  {error || t("poolNotFoundBody")}
                </CardDescription>
              </CardHeader>
              <CardContent className="py-4 text-sm text-muted-foreground">
                {t("checkLinkBody")}
              </CardContent>
              <CardFooter className="flex flex-col sm:flex-row gap-2 justify-center pt-4">
                <Button variant="outline" asChild className="w-full sm:w-auto">
                  <Link href="/explore">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t("explorePools")}
                  </Link>
                </Button>
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/dashboard">{t("goToDashboard")}</Link>
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        </main>
      </div>
    )
  }

  const tokenSymbol = group.token_symbol ?? "XLM"
  const formattedCreator = group.creator_address
    ? `${group.creator_address.slice(0, 8)}...${group.creator_address.slice(-6)}`
    : "N/A"

  // Render deposit requirements text/elements based on pool type
  const renderDepositRequirements = () => {
    switch (group.type) {
      case "rotational":
        return (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground font-medium">{t("depositRequirement")}</p>
            <p className="text-2xl font-bold text-foreground">
              {group.contribution_amount?.toFixed(2)} {tokenSymbol}
            </p>
            <p className="text-xs text-muted-foreground capitalize flex items-center gap-1.5 mt-1">
              <Clock className="h-3.5 w-3.5" />
              {t("contributionFrequency", { freq: group.frequency || "N/A" })}
            </p>
          </div>
        )
      case "target":
        return (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground font-medium">
              {t("targetAndRequirements")}
            </p>
            <div className="flex flex-col gap-1">
              <p className="text-2xl font-bold text-foreground">
                {t("targetLabel", {
                  amount: group.target_amount?.toFixed(2) ?? "",
                  token: tokenSymbol,
                })}
              </p>
              {group.contribution_amount && (
                <p className="text-sm text-muted-foreground">
                  {t("expectedDeposit", {
                    amount: group.contribution_amount.toFixed(2),
                    token: tokenSymbol,
                  })}
                </p>
              )}
            </div>
            {group.deadline && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                <Clock className="h-3.5 w-3.5" />
                {t("targetDeadline", { date: new Date(group.deadline).toLocaleDateString() })}
              </p>
            )}
          </div>
        )
      case "flexible":
        return (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground font-medium">{t("depositRequirement")}</p>
            <p className="text-2xl font-bold text-foreground">
              {group.minimum_deposit
                ? t("flexibleMin", { amount: group.minimum_deposit.toFixed(2), token: tokenSymbol })
                : t("flexibleNoMin")}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              {t("flexibleYield", {
                status: group.yield_enabled ? t("yieldEnabled") : t("yieldDisabled"),
              })}
            </p>
          </div>
        )
      default:
        return null
    }
  }

  // CTA button state determination
  const renderCTA = () => {
    if (!isConnected) {
      return (
        <Button
          size="lg"
          onClick={connect}
          className="w-full font-semibold transition-all hover:scale-[1.01] flex items-center justify-center gap-2"
        >
          <Wallet className="h-5 w-5" />
          {t("connectWalletCta")}
        </Button>
      )
    }

    if (isAlreadyMember) {
      return (
        <div className="space-y-3 w-full">
          <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4" />
            <span>{t("alreadyMember")}</span>
          </div>
          <Button variant="outline" size="lg" asChild className="w-full font-semibold">
            <Link href={`/dashboard/group/${group.id}`}>{t("goToPoolDetails")}</Link>
          </Button>
        </div>
      )
    }

    if (loadingRequest) {
      return (
        <Button disabled size="lg" className="w-full">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {t("checkingStatus")}
        </Button>
      )
    }

    if (requestStatus === "pending") {
      return (
        <Button
          disabled
          variant="secondary"
          size="lg"
          className="w-full flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="h-5 w-5 text-amber-500" />
          {t("requestPending")}
        </Button>
      )
    }

    return (
      <Button
        size="lg"
        onClick={handleRequestJoin}
        disabled={submitting}
        className="w-full font-semibold transition-all hover:scale-[1.01]"
      >
        {submitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            {t("submittingRequest")}
          </>
        ) : (
          t("requestToJoin")
        )}
      </Button>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-12">
      <DashboardHeader />
      <main className="flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-xl"
        >
          <Card className="border border-border/60 shadow-2xl overflow-hidden bg-card/65 backdrop-blur-md">
            <div className="h-2 bg-gradient-to-r from-primary via-purple-500 to-indigo-500" />

            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge className="bg-primary/10 text-primary border-primary/25 capitalize px-3 py-1 font-medium">
                  {tPool(`type.${group.type}`)} {t("poolSuffix")}
                </Badge>
                <div className="flex items-center text-xs text-muted-foreground gap-1.5">
                  <Users className="h-4 w-4" />
                  <span className="font-semibold text-foreground">{group.members_count}</span>{" "}
                  {t("membersLabel")}
                </div>
              </div>

              <div className="space-y-2">
                <CardTitle className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
                  {group.name}
                  <Sparkles className="h-5 w-5 text-amber-400 shrink-0" />
                </CardTitle>
                <CardDescription className="text-muted-foreground text-sm leading-relaxed">
                  {group.description || t("noDescription")}
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Deposit requirements Card */}
              <div className="p-4 rounded-xl bg-muted/40 border border-muted-foreground/10">
                {renderDepositRequirements()}
              </div>

              {/* Creator & Contract Info */}
              <div className="space-y-3.5 text-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/40 pb-3 gap-1">
                  <span className="text-muted-foreground font-medium">{t("creatorAddress")}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-foreground bg-muted px-2 py-0.5 rounded break-all font-semibold">
                      {formattedCreator}
                    </span>
                    {group.creator_address && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={handleCopyCreator}
                        aria-label={t("copyCreatorAria")}
                      >
                        {copiedCreator ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-muted-foreground font-medium">{t("contractAddress")}</span>
                  <span className="font-mono text-xs text-foreground bg-muted px-2 py-0.5 rounded break-all max-w-[280px] sm:max-w-none truncate">
                    {group.contract_address}
                  </span>
                </div>
              </div>
            </CardContent>

            <CardFooter className="pt-2 flex flex-col gap-3">
              {renderCTA()}
              <div className="w-full text-center">
                <Link
                  href="/explore"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" />
                  {t("exploreOtherPools")}
                </Link>
              </div>
            </CardFooter>
          </Card>
        </motion.div>
      </main>
    </div>
  )
}
