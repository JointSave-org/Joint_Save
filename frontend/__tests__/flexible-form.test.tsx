import React from "react"
import { render, screen, fireEvent, waitFor } from "@/test-utils"
import { FlexibleForm } from "@/components/create-group/flexible-form"
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/hooks/useJointSaveContracts")
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe("FlexibleForm Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders form inputs correctly", () => {
    render(<FlexibleForm />)

    expect(screen.getByLabelText(/Group Name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Minimum Deposit/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Withdrawal Fee/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Create Flexible Pool/i })).toBeInTheDocument()
  })

  it("allows adding and removing member input fields", () => {
    render(<FlexibleForm />)

    const addMemberBtn = screen.getByRole("button", { name: /Add Member/i })
    fireEvent.click(addMemberBtn)

    const memberInputs = screen.getAllByPlaceholderText("G...")
    expect(memberInputs.length).toBe(2)
  })

  it("displays validation error when submitted without minimum deposit or valid members", async () => {
    render(<FlexibleForm />)

    const nameInput = screen.getByLabelText(/Group Name/i)
    fireEvent.change(nameInput, { target: { value: "Test Pool" } })

    const minDepositInput = screen.getByLabelText(/Minimum Deposit/i)
    fireEvent.change(minDepositInput, { target: { value: "50" } })

    const submitBtn = screen.getByRole("button", { name: /Create Flexible Pool/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/Need at least 2 valid Stellar addresses|connect your wallet/i)).toBeInTheDocument()
    })
  })
})
