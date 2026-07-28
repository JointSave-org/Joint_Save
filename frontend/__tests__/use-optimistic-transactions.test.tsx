import { renderHook, act } from "@testing-library/react"
import { useOptimisticTransactions } from "@/hooks/useOptimisticTransactions"
import { describe, it, expect } from "vitest"

describe("useOptimisticTransactions Hook", () => {
  it("initializes with an empty transactions list", () => {
    const { result } = renderHook(() => useOptimisticTransactions())
    expect(result.current.transactions).toEqual([])
  })

  it("applies optimistic transaction on addTransaction", () => {
    const { result } = renderHook(() => useOptimisticTransactions())

    act(() => {
      result.current.addTransaction({ id: "tx-100", type: "deposit", amount: 250 })
    })

    expect(result.current.transactions).toHaveLength(1)
    expect(result.current.transactions[0]).toEqual({
      id: "tx-100",
      type: "deposit",
      amount: 250,
      status: "pending",
    })
  })

  it("marks transaction as failed and preserves error message on markError", () => {
    const { result } = renderHook(() => useOptimisticTransactions())

    act(() => {
      result.current.addTransaction({ id: "tx-101", type: "withdraw", amount: 100 })
    })

    act(() => {
      result.current.markError("tx-101", "Insufficient funds")
    })

    expect(result.current.transactions[0].status).toBe("failed")
    expect(result.current.transactions[0].error).toBe("Insufficient funds")
  })

  it("removes transaction on markSuccess", () => {
    const { result } = renderHook(() => useOptimisticTransactions())

    act(() => {
      result.current.addTransaction({ id: "tx-102", type: "deposit", amount: 500 })
    })

    act(() => {
      result.current.markSuccess("tx-102")
    })

    expect(result.current.transactions).toHaveLength(0)
  })

  it("rolls back transaction on rollback", () => {
    const { result } = renderHook(() => useOptimisticTransactions())

    act(() => {
      result.current.addTransaction({ id: "tx-103", type: "deposit", amount: 50 })
    })

    act(() => {
      result.current.rollback("tx-103")
    })

    expect(result.current.transactions).toHaveLength(0)
  })
})
