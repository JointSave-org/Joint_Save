"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Users, Target, Zap, Wallet, Rocket, PiggyBank, ArrowRight, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useStellar } from "@/components/web3-provider"
import { useOnboarding } from "@/hooks/useOnboarding"
import { ONBOARDING_STEPS, ONBOARDING_STEP_COUNT, completedStepCount } from "@/lib/onboarding"

/** Smart defaults used when creating a pool from the wizard. */
const SMART_DEFAULTS: Record<
  "rotational" | "target" | "flexible",
  { name: string; amount: string; frequency: string }
> = {
  rotational: { name: "My First Savings Pool", amount: "100", frequency: "weekly" },
  target: { name: "My First Savings Goal", amount: "500", frequency: "monthly" },
  flexible: { name: "My Flexible Savings Pool", amount: "10", frequency: "" },
}

const POOL_TYPE_CARDS = [
  { type: "rotational" as const, icon: Users },
  { type: "target" as const, icon: Target },
  { type: "flexible" as const, icon: Zap },
]

interface WizardProps {
  open: boolean
  onClose: () => void
}

export function OnboardingWizard({ open, onClose }: WizardProps) {
  const t = useTranslations("onboarding.wizard")
  const tSteps = useTranslations("onboarding.steps")
  const router = useRouter()
  const { address, connect } = useStellar()
  const { state, completeStep, skip } = useOnboarding()

  const [selectedType, setSelectedType] = useState<"rotational" | "target" | "flexible" | null>(
    null
  )
  const [poolName, setPoolName] = useState("")
  const [poolAmount, setPoolAmount] = useState("")
  const [createdPoolId, setCreatedPoolId] = useState<string | null>(null)
  const [loadingPool, setLoadingPool] = useState(false)

  const step = Math.min(Math.max(state.currentStep, 0), ONBOARDING_STEP_COUNT - 1)
  const progress = (completedStepCount(state) / ONBOARDING_STEP_COUNT) * 100
  const stepName = ONBOARDING_STEPS[step]

  // Step 5 (Make your first deposit) shows the pool the user just created.
  useEffect(() => {
    if (!open || step !== 4 || createdPoolId || !address) return
    let cancelled = false
    setLoadingPool(true)
    fetch(`/api/pools?creator=${address.toLowerCase()}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((json) => {
        if (cancelled) return
        const pools = Array.isArray(json) ? json : (json.data ?? [])
        if (pools.length > 0) setCreatedPoolId(pools[0].id)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPool(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, step, createdPoolId, address])

  // When the wallet connects mid-tour, auto-advance past the wallet step.
  useEffect(() => {
    if (open && address && !state.steps.walletConnected) {
      completeStep("walletConnected")
    }
  }, [open, address, state.steps.walletConnected, completeStep])

  // Re-seed the smart defaults whenever a pool type is picked.
  const handleSelectType = useCallback(
    (type: "rotational" | "target" | "flexible") => {
      setSelectedType(type)
      const defaults = SMART_DEFAULTS[type]
      setPoolName(defaults.name)
      setPoolAmount(defaults.amount)
      completeStep("poolTypeSelected")
    },
    [completeStep]
  )

  const handleStart = useCallback(() => {
    completeStep("welcome")
  }, [completeStep])

  const handleCreatePool = useCallback(() => {
    if (!selectedType) return
    const defaults = SMART_DEFAULTS[selectedType]
    const params = new URLSearchParams()
    params.set("onboarding", "1")
    params.set("name", poolName.trim() || t(`defaultPoolNames.${selectedType}`))
    if (selectedType === "rotational" || selectedType === "target") {
      params.set("amount", poolAmount.trim() || defaults.amount)
      params.set("frequency", defaults.frequency)
    } else {
      params.set("minimumDeposit", poolAmount.trim() || defaults.amount)
    }
    onClose()
    router.push(`/dashboard/create/${selectedType}?${params.toString()}`)
  }, [selectedType, poolName, poolAmount, onClose, router])

  const handleGoDeposit = useCallback(() => {
    completeStep("firstPoolCreated")
    onClose()
    // Direct to the pool detail page with the deposit button highlighted.
    router.push(
      createdPoolId ? `/dashboard/group/${createdPoolId}?highlight=deposit` : "/dashboard"
    )
  }, [completeStep, createdPoolId, onClose, router])

  const stepCopy: Record<number, { title: string; subtitle: string }> = {
    0: { title: t("step0Title"), subtitle: t("step0Subtitle") },
    1: { title: t("step1Title"), subtitle: t("step1Subtitle") },
    2: { title: t("step2Title"), subtitle: t("step2Subtitle") },
    3: { title: t("step3Title"), subtitle: t("step3Subtitle") },
    4: { title: t("step4Title"), subtitle: t("step4Subtitle") },
  }

  const renderStep = () => {
    switch (step) {
      case 0: // Welcome
        return (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Rocket className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-muted-foreground">{t("welcomeBody")}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button onClick={handleStart} className="gap-2">
                {t("getStarted")}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={skip}>
                {t("skipTour")}
              </Button>
            </div>
          </div>
        )

      case 1: // Connect Wallet
        return (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Wallet className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-3">
              <p className="text-muted-foreground">{t("walletBody")}</p>
              {address ? (
                <p className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" />
                  {t("connected")}
                </p>
              ) : (
                <Button onClick={() => connect()} className="gap-2">
                  <Wallet className="h-4 w-4" />
                  {t("connectWallet")}
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => completeStep("walletConnected")}
              disabled={!address}
            >
              {t("continueBtn")}
            </Button>
          </div>
        )

      case 2: // Choose Pool Type
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {POOL_TYPE_CARDS.map((card) => (
                <button
                  key={card.type}
                  onClick={() => handleSelectType(card.type)}
                  className={`rounded-xl border p-4 text-left transition-all hover:border-primary/60 hover:bg-primary/5 ${
                    selectedType === card.type ? "border-primary ring-2 ring-primary/30" : ""
                  }`}
                  aria-pressed={selectedType === card.type}
                >
                  <card.icon className="h-6 w-6 text-primary mb-2" />
                  <p className="font-semibold">{t(`poolTypes.${card.type}.title`)}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t(`poolTypes.${card.type}.description`)}
                  </p>
                </button>
              ))}
            </div>
            <Button
              className="w-full gap-2"
              disabled={!selectedType}
              onClick={() => completeStep("poolTypeSelected")}
            >
              {t("continueBtn")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )

      case 3: // Create Your First Pool
        return (
          <div className="space-y-5">
            {selectedType && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
                <span className="font-medium capitalize">
                  {t(`poolTypes.${selectedType}.title`)} {t("poolTypeSuffix")}
                </span>
                <span className="text-muted-foreground">{t("prefilledNote")}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="onboarding-pool-name">{t("poolNameLabel")}</Label>
              <Input
                id="onboarding-pool-name"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                placeholder={t(`defaultPoolNames.${selectedType ?? "rotational"}`)}
                maxLength={50}
              />
            </div>
            {selectedType && selectedType !== "flexible" && (
              <div className="space-y-2">
                <Label htmlFor="onboarding-pool-amount">
                  {selectedType === "target"
                    ? t("targetAmountLabel")
                    : t("contributionAmountLabel")}
                </Label>
                <Input
                  id="onboarding-pool-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={poolAmount}
                  onChange={(e) => setPoolAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {selectedType === "rotational"
                    ? t("defaultRotational", { amount: SMART_DEFAULTS.rotational.amount, members: 5 })
                    : t("defaultTarget", { amount: SMART_DEFAULTS.target.amount, members: 10 })}
                </p>
              </div>
            )}
            <Button className="w-full gap-2" onClick={handleCreatePool}>
              <PiggyBank className="h-4 w-4" />
              {t("createMyPool")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("createPoolNote")}</p>
          </div>
        )

      case 4: // Make Your First Deposit
        return (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
              <PiggyBank className="h-8 w-8 text-emerald-500" />
            </div>
            <p className="text-muted-foreground">
              {t.rich("depositBody", { strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
            <Button
              onClick={handleGoDeposit}
              className="gap-2"
              disabled={loadingPool && !createdPoolId}
            >
              {loadingPool && !createdPoolId ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t("findingPool")}
                </span>
              ) : (
                <>
                  {t("goToMyPool")}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg"
            role="dialog"
            aria-modal="true"
            aria-label={t("dialogAriaLabel")}
          >
            <Card className="p-6 sm:p-8 relative">
              <button
                onClick={skip}
                aria-label={t("skipAria")}
                className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              {/* Progress bar */}
              <div className="mb-6">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                  <span className="font-medium capitalize">
                    {t("stepOf", { current: step + 1, total: ONBOARDING_STEP_COUNT })}
                  </span>
                  <span className="capitalize">{tSteps(stepName)}</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-1">{stepCopy[step].title}</h2>
                <p className="text-sm text-muted-foreground">{stepCopy[step].subtitle}</p>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                >
                  {renderStep()}
                </motion.div>
              </AnimatePresence>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
