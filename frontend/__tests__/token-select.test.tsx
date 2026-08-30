import React from "react"
import { render, screen } from "@/test-utils"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { TokenSelect } from "@/components/create-group/token-select"
import { SUPPORTED_TOKENS } from "@/lib/token-utils"

describe("TokenSelect", () => {
  it("defaults to native XLM in the trigger", () => {
    render(<TokenSelect onChange={vi.fn()} />)
    expect(screen.getByRole("combobox")).toHaveTextContent("XLM (native)")
  })

  it("reports the registry's USDC token when USDC is selected", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TokenSelect onChange={onChange} />)

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "USDC" }))

    const usdc = SUPPORTED_TOKENS.find((t) => t.symbol === "USDC")!
    expect(onChange).toHaveBeenCalledWith({
      address: usdc.contractAddress,
      symbol: usdc.symbol,
      decimals: usdc.decimals,
    })
    expect(screen.getByText(/see the bridge guide/i)).toBeInTheDocument()
  })

  it("switches back to native XLM when re-selected", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TokenSelect onChange={onChange} />)

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "USDC" }))

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "XLM (native)" }))

    expect(onChange).toHaveBeenLastCalledWith({ address: "native", symbol: "XLM", decimals: 7 })
  })
})
