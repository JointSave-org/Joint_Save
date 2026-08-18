"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { CheckCircle2, Circle, ChevronDown, Sparkles } from "lucide-react"
import { Card } from "@/components/ui/card"
import { useOnboarding } from "@/hooks/useOnboarding"
import { ONBOARDING_STEPS } from "@/lib/onboarding"

const STEP_LABELS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  welcome: "Welcome",
  walletConnected: "Connect your wallet",
  poolTypeSelected: "Choose a pool type",
  firstPoolCreated: "Create your first pool",
  firstDepositMade: "Make your first deposit",
}

/**
 * Persistent, collapsible checklist shown on the dashboard sidebar while the
 * user is still onboarding. Auto-hides once every step is complete.
 */
export function OnboardingChecklist() {
  const { state } = useOnboarding()
  const [collapsed, setCollapsed] = useState(false)

  // Auto-hide when the tour is done or dismissed.
  if (state.completed || state.dismissed) return null

  const completed = ONBOARDING_STEPS.filter((key) => state.steps[key]).length
  const total = ONBOARDING_STEPS.length

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Getting Started</h3>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand onboarding checklist" : "Collapse onboarding checklist"}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
          />
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {completed} of {total} steps complete
      </p>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden space-y-1"
          >
            {ONBOARDING_STEPS.map((key) => {
              const done = state.steps[key]
              const isCurrent =
                !done &&
                ONBOARDING_STEPS.findIndex((k) => !state.steps[k]) === ONBOARDING_STEPS.indexOf(key)
              return (
                <li
                  key={key}
                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${
                    isCurrent ? "bg-primary/10 text-primary" : "text-muted-foreground"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <span className={done ? "line-through opacity-70" : ""}>{STEP_LABELS[key]}</span>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </Card>
  )
}
