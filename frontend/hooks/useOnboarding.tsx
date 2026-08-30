"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useStellar } from "@/components/web3-provider"
import {
  getOnboardingState,
  setOnboardingState,
  markStepComplete,
  dismissOnboarding,
  resetOnboarding,
  markAllStepsComplete,
  isOnboardingCompleteOrDismissed,
  type OnboardingState,
} from "@/lib/onboarding"

/**
 * Broadcast whenever onboarding state changes so components outside the
 * provider (e.g. contextual-help tooltips) can react without re-reading on
 * every render.
 */
export const ONBOARDING_CHANGE_EVENT = "jointsave:onboarding-change"

interface PoolRow {
  id: string
  name: string
  total_saved?: number
}

interface OnboardingContextValue {
  state: OnboardingState
  /** Mark a single wizard step complete (persists to localStorage). */
  completeStep: (step: keyof OnboardingState["steps"]) => void
  /** Skip/dismiss the tour — it will not appear again. */
  skip: () => void
  /** Clear onboarding progress (used by tests and "start over"). */
  restart: () => void
  /** True while the wizard should be shown to this user. */
  showWizard: boolean
  /** Number of completed steps (0-5). */
  completedCount: number
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

/**
 * Owns the single source of truth for onboarding state so the wizard, the
 * dashboard checklist, and the contextual-help tooltips all stay in sync
 * within a session. State is persisted to localStorage on every change.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useStellar()
  const [state, setState] = useState<OnboardingState>(() => getOnboardingState())
  const checkedRef = useRef(false)

  // Keep localStorage in sync and broadcast the change to non-provider
  // components (contextual-help pulse indicators).
  useEffect(() => {
    setOnboardingState(state)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(ONBOARDING_CHANGE_EVENT))
    }
  }, [state])

  // Detect existing pools / deposits for the connected wallet once, so users
  // who already created a pool never see the wizard again.
  useEffect(() => {
    if (!isConnected || !address || checkedRef.current) return
    if (isOnboardingCompleteOrDismissed(state)) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pools?creator=${address.toLowerCase()}`)
        if (!res.ok) return
        const json = await res.json()
        const pools: PoolRow[] = Array.isArray(json) ? json : (json.data ?? [])
        if (cancelled || pools.length === 0) return

        checkedRef.current = true
        // Existing user with pools → create + deposit steps are already done.
        const hasDeposit = pools.some((p) => (p.total_saved ?? 0) > 0)
        setState((prev) => {
          const withPool = markStepComplete(prev, "firstPoolCreated")
          const withDeposit = hasDeposit ? markStepComplete(withPool, "firstDepositMade") : withPool
          // Complete the earlier tutorial steps too so the wizard is skipped.
          return markAllStepsComplete(withDeposit)
        })
      } catch {
        // Offline / API error — leave onboarding as-is.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isConnected, address, state.completed, state.dismissed])

  const completeStep = useCallback(
    (step: keyof OnboardingState["steps"]) => setState((prev) => markStepComplete(prev, step)),
    []
  )

  const skip = useCallback(() => setState((prev) => dismissOnboarding(prev)), [])

  const restart = useCallback(() => {
    resetOnboarding()
    setState(getOnboardingState())
  }, [])

  const showWizard = !isOnboardingCompleteOrDismissed(state)

  const completedCount =
    Number(state.steps.welcome) +
    Number(state.steps.walletConnected) +
    Number(state.steps.poolTypeSelected) +
    Number(state.steps.firstPoolCreated) +
    Number(state.steps.firstDepositMade)

  const value = useMemo<OnboardingContextValue>(
    () => ({ state, completeStep, skip, restart, showWizard, completedCount }),
    [state, completeStep, skip, restart, showWizard, completedCount]
  )

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
}

/**
 * Read the shared onboarding state. Must be rendered inside OnboardingProvider
 * (the dashboard wraps its whole tree in one).
 */
export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error("useOnboarding must be used within an OnboardingProvider")
  }
  return context
}
