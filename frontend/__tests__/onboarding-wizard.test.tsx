import React from "react"
import { render, screen, fireEvent, waitFor } from "@/test-utils"
import { describe, it, expect, vi, beforeEach } from "vitest"

// Static reference for use inside the framer-motion mock factory below.
const ReactJSX = React

const completeStepMock = vi.fn()
const skipMock = vi.fn()
let wizardState: {
  completed: boolean
  dismissed: boolean
  currentStep: number
  steps: {
    welcome: boolean
    walletConnected: boolean
    poolTypeSelected: boolean
    firstPoolCreated: boolean
    firstDepositMade: boolean
  }
} = {
  completed: false,
  dismissed: false,
  currentStep: 0,
  steps: {
    welcome: false,
    walletConnected: false,
    poolTypeSelected: false,
    firstPoolCreated: false,
    firstDepositMade: false,
  },
}

vi.mock("@/hooks/useOnboarding", () => ({
  useOnboarding: () => ({
    state: wizardState,
    completeStep: completeStepMock,
    skip: skipMock,
    showWizard: !wizardState.completed && !wizardState.dismissed,
    completedCount: 0,
  }),
}))

vi.mock("@/components/web3-provider", () => ({
  useStellar: () => ({
    address: null,
    isConnected: false,
    connect: vi.fn().mockResolvedValue(undefined),
  }),
  Web3Provider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("framer-motion", () => {
  const Motion = ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
    ReactJSX.createElement("div", { ...props, "data-motion": true }, children)
  return {
    motion: new Proxy(
      {},
      {
        get: () => Motion,
      }
    ),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      ReactJSX.createElement("div", { "data-animate-presence": true }, children),
  }
})

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"

function setStep(step: number) {
  wizardState = {
    ...wizardState,
    currentStep: step,
    steps: {
      welcome: step >= 1,
      walletConnected: step >= 2,
      poolTypeSelected: step >= 3,
      firstPoolCreated: step >= 4,
      firstDepositMade: false,
    },
  }
}

describe("OnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = "" // Clear any lingering DOM elements
    wizardState = {
      completed: false,
      dismissed: false,
      currentStep: 0,
      steps: {
        welcome: false,
        walletConnected: false,
        poolTypeSelected: false,
        firstPoolCreated: false,
        firstDepositMade: false,
      },
    }
  })

  it("renders nothing when closed", () => {
    render(<OnboardingWizard open={false} onClose={skipMock} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("renders the welcome step with Get Started and Skip", () => {
    render(<OnboardingWizard open={true} onClose={skipMock} />)
    expect(screen.getByRole("dialog", { name: "Onboarding wizard" })).toBeInTheDocument()
    expect(screen.getByText("Welcome to JointSave")).toBeInTheDocument()
    expect(screen.getByText("Get Started")).toBeInTheDocument()
    expect(screen.getByText("Skip Tour")).toBeInTheDocument()
  })

  it("advances to the connect-wallet step on Get Started", () => {
    render(<OnboardingWizard open={true} onClose={skipMock} />)
    fireEvent.click(screen.getByText("Get Started"))
    expect(completeStepMock).toHaveBeenCalledWith("welcome")
  })

  it("skips and dismisses the tour", () => {
    render(<OnboardingWizard open={true} onClose={skipMock} />)
    fireEvent.click(screen.getByText("Skip Tour"))
    expect(skipMock).toHaveBeenCalled()
  })

  it("shows pool type cards on the pool-type step", () => {
    setStep(2)
    render(<OnboardingWizard open={true} onClose={skipMock} />)
    expect(screen.getByText("Rotational")).toBeInTheDocument()
    expect(screen.getByText("Target")).toBeInTheDocument()
    expect(screen.getByText("Flexible")).toBeInTheDocument()
  })

  it("marks poolTypeSelected when a pool type is picked", () => {
    setStep(2)
    render(<OnboardingWizard open={true} onClose={skipMock} />)
    fireEvent.click(screen.getByText("Rotational"))
    expect(completeStepMock).toHaveBeenCalledWith("poolTypeSelected")
  })

  it("shows smart-default prefill fields on the create step", () => {
    setStep(3)
    render(<OnboardingWizard open={true} onClose={skipMock} />)
    expect(screen.getByLabelText("Pool name")).toBeInTheDocument()
    // Continue disabled until a type is picked from state — the form still renders.
    expect(screen.getByRole("button", { name: /Create my pool/ })).toBeInTheDocument()
  })

  it("renders the final deposit step with a link to the pool", async () => {
    setStep(4)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "pool-abc", name: "My First Savings Pool" }],
    })
    render(<OnboardingWizard open={true} onClose={skipMock} />)
    await waitFor(() => {
      expect(screen.getByText(/Nice work/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole("button", { name: /Go to my pool/ }))
    expect(completeStepMock).toHaveBeenCalledWith("firstPoolCreated")
  })
})
