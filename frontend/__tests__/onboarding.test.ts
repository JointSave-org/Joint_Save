import { describe, it, expect, beforeEach } from "vitest"
import {
  ONBOARDING_STORAGE_KEY,
  defaultOnboardingState,
  getOnboardingState,
  setOnboardingState,
  resetOnboarding,
  markStepComplete,
  markAllStepsComplete,
  dismissOnboarding,
  isOnboardingCompleteOrDismissed,
  completedStepCount,
  ONBOARDING_STEPS,
} from "@/lib/onboarding"

describe("onboarding state", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("returns the default state when nothing is stored", () => {
    const state = getOnboardingState()
    expect(state.completed).toBe(false)
    expect(state.dismissed).toBe(false)
    expect(state.currentStep).toBe(0)
    expect(ONBOARDING_STEPS.every((key) => state.steps[key] === false)).toBe(true)
  })

  it("persists and reads back state via localStorage", () => {
    const state = { ...defaultOnboardingState(), currentStep: 2, dismissed: true }
    setOnboardingState(state)
    expect(getOnboardingState().currentStep).toBe(2)
    expect(getOnboardingState().dismissed).toBe(true)
  })

  it("survives refresh (localStorage is the source of truth)", () => {
    setOnboardingState({
      ...defaultOnboardingState(),
      steps: { ...defaultOnboardingState().steps, welcome: true, walletConnected: true },
    })
    const restored = getOnboardingState()
    expect(restored.steps.welcome).toBe(true)
    expect(restored.steps.walletConnected).toBe(true)
    expect(restored.steps.poolTypeSelected).toBe(false)
  })

  it("resetOnboarding clears stored progress", () => {
    setOnboardingState({ ...defaultOnboardingState(), completed: true })
    resetOnboarding()
    expect(getOnboardingState().completed).toBe(false)
  })

  it("marks a step complete and advances to the next incomplete step", () => {
    let state = markStepComplete(defaultOnboardingState(), "welcome")
    expect(state.steps.welcome).toBe(true)
    expect(state.currentStep).toBe(1)

    state = markStepComplete(state, "walletConnected")
    state = markStepComplete(state, "poolTypeSelected")
    expect(state.currentStep).toBe(3)
    expect(state.completed).toBe(false)
  })

  it("completes the whole tour once every step is done", () => {
    let state = defaultOnboardingState()
    for (const key of ONBOARDING_STEPS) {
      state = markStepComplete(state, key)
    }
    expect(state.completed).toBe(true)
    expect(isOnboardingCompleteOrDismissed(state)).toBe(true)
    expect(completedStepCount(state)).toBe(ONBOARDING_STEPS.length)
  })

  it("markAllStepsComplete flags every step and the tour as done", () => {
    const state = markAllStepsComplete(defaultOnboardingState())
    expect(state.completed).toBe(true)
    expect(ONBOARDING_STEPS.every((key) => state.steps[key])).toBe(true)
  })

  it("dismissOnboarding hides the wizard without completing steps", () => {
    const state = dismissOnboarding(defaultOnboardingState())
    expect(state.dismissed).toBe(true)
    expect(state.completed).toBe(false)
    expect(isOnboardingCompleteOrDismissed(state)).toBe(true)
    expect(completedStepCount(state)).toBe(0)
  })

  it("tolerates corrupted localStorage data", () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "{not valid json")
    expect(getOnboardingState().completed).toBe(false)
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ nonsense: true }))
    expect(getOnboardingState().completed).toBe(false)
  })
})
