"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ONBOARDING_CHANGE_EVENT } from "@/hooks/useOnboarding"
import { getOnboardingState, isOnboardingCompleteOrDismissed } from "@/lib/onboarding"

interface ContextualHelpProps {
  /** Short explanation shown in the tooltip. */
  content: string
  /** Optional heading for the tooltip. */
  title?: string
  /**
   * When true (default for first-time visitors), the "?" icon pulses to draw
   * attention to the feature. Existing users who finished onboarding see a
   * static icon instead.
   */
  pulse?: boolean
  className?: string
}

/**
 * Small "?" icon that explains a UI element on hover/focus. First-time visitors
 * get a pulsing indicator until they finish onboarding.
 *
 * Works on any page: it reads the persisted onboarding state directly and
 * listens for the change event broadcast by the dashboard's provider, so the
 * pulse turns off as soon as the tour is completed or dismissed.
 */
export function ContextualHelp({ content, title, pulse, className }: ContextualHelpProps) {
  const t = useTranslations("onboarding.help")
  const [pulsing, setPulsing] = useState(
    () => !isOnboardingCompleteOrDismissed(getOnboardingState())
  )

  useEffect(() => {
    const refresh = () => setPulsing(!isOnboardingCompleteOrDismissed(getOnboardingState()))
    window.addEventListener(ONBOARDING_CHANGE_EVENT, refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener(ONBOARDING_CHANGE_EVENT, refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  const shouldPulse = pulse ?? pulsing

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={title ? t("ariaLabelWithTitle", { title }) : t("ariaLabelDefault")}
            className={`inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              shouldPulse ? "animate-pulse" : ""
            } ${className ?? ""}`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-xs leading-relaxed">
          {title && <p className="font-semibold mb-1">{title}</p>}
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
