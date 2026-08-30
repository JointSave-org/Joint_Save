/**
 * Onboarding progress tracking.
 *
 * New users are walked through a 5-step wizard on their first dashboard visit.
 * Progress persists in localStorage so a refresh (or closing the tab) never
 * resets the tour, and once every step is complete (or the tour is dismissed)
 * the wizard stops appearing.
 *
 * State shape:
 * - completed  : every step has been finished — wizard never shows again
 * - currentStep: 0-4 index of the step the user is on
 * - steps      : per-step completion flags (welcome, walletConnected,
 *                poolTypeSelected, firstPoolCreated, firstDepositMade)
 * - dismissed  : the user hit "Skip" — wizard never shows again
 */

export const ONBOARDING_STORAGE_KEY = "jointsave:onboarding"

export interface OnboardingSteps {
  welcome: boolean
  walletConnected: boolean
  poolTypeSelected: boolean
  firstPoolCreated: boolean
  firstDepositMade: boolean
}

export interface OnboardingState {
  completed: boolean
  /** 0-4 index of the active step. */
  currentStep: number
  steps: OnboardingSteps
  dismissed: boolean
}

export const ONBOARDING_STEP_COUNT = 5

export const defaultOnboardingState = (): OnboardingState => ({
  completed: false,
  currentStep: 0,
  steps: {
    welcome: false,
    walletConnected: false,
    poolTypeSelected: false,
    firstPoolCreated: false,
    firstDepositMade: false,
  },
  dismissed: false,
})

export const EMPTY_STEPS = defaultOnboardingState().steps

function isOnboardingState(value: unknown): value is OnboardingState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<OnboardingState>
  return (
    typeof candidate.completed === "boolean" &&
    typeof candidate.currentStep === "number" &&
    typeof candidate.dismissed === "boolean" &&
    typeof candidate.steps === "object" &&
    candidate.steps !== null &&
    typeof (candidate.steps as OnboardingSteps).welcome === "boolean"
  )
}

/**
 * Read the current onboarding state from localStorage. Returns the default
 * (not-completed) state when nothing has been stored yet or storage is
 * unavailable (SSR, private mode).
 */
export function getOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return defaultOnboardingState()
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return defaultOnboardingState()
    const parsed: unknown = JSON.parse(raw)
    if (!isOnboardingState(parsed)) return defaultOnboardingState()
    return { ...defaultOnboardingState(), ...parsed, steps: { ...EMPTY_STEPS, ...parsed.steps } }
  } catch {
    return defaultOnboardingState()
  }
}

/** Persist the onboarding state to localStorage (best-effort). */
export function setOnboardingState(state: OnboardingState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage full or unavailable — onboarding simply won't persist
  }
}

/** Clear onboarding progress entirely (used by tests and "start over"). */
export function resetOnboarding(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** True when the wizard should not be shown at all. */
export function isOnboardingCompleteOrDismissed(state: OnboardingState): boolean {
  return state.completed || state.dismissed
}

/**
 * All five steps finished — marks the tour complete so it never shows again.
 */
export function markAllStepsComplete(state: OnboardingState): OnboardingState {
  return {
    ...state,
    completed: true,
    currentStep: ONBOARDING_STEP_COUNT - 1,
    steps: {
      welcome: true,
      walletConnected: true,
      poolTypeSelected: true,
      firstPoolCreated: true,
      firstDepositMade: true,
    },
  }
}

type StepKey = keyof OnboardingSteps

/** Mark a single step complete and advance the wizard to the next step. */
export function markStepComplete(state: OnboardingState, step: StepKey): OnboardingState {
  const steps = { ...state.steps, [step]: true }
  const next: OnboardingState = { ...state, steps }
  const allDone = ONBOARDING_STEPS.every((key) => steps[key])
  if (allDone) return markAllStepsComplete(next)
  // Advance to the first incomplete step (usually the next one).
  const nextIndex = ONBOARDING_STEPS.findIndex((key) => !steps[key])
  return { ...next, currentStep: nextIndex === -1 ? ONBOARDING_STEP_COUNT - 1 : nextIndex }
}

/** Ordered step keys, matching the wizard's step order. */
export const ONBOARDING_STEPS: StepKey[] = [
  "welcome",
  "walletConnected",
  "poolTypeSelected",
  "firstPoolCreated",
  "firstDepositMade",
]

/** Dismiss the tour ("Skip") — it will not appear again. */
export function dismissOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, dismissed: true }
}

/** Count of completed steps (0-5), for progress bars and checklists. */
export function completedStepCount(state: OnboardingState): number {
  return ONBOARDING_STEPS.filter((key) => state.steps[key]).length
}
