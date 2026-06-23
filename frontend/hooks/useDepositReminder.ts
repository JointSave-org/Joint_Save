"use client"

import { useCallback } from "react"
import { Contract, rpc, xdr, scValToNative } from "@stellar/stellar-sdk"
import { STELLAR_RPC_URL, STELLAR_NETWORK_PASSPHRASE } from "@/components/web3-provider"
import { supabase } from "@/lib/supabase"

/**
 * Returns a function that:
 * 1. Calls `deposit_reminder_due` on the given rotational pool contract.
 * 2. If true, inserts a `deposit_reminder` row into `pool_activity` so the
 *    notify-pool-event webhook fires emails/in-app notifications.
 *
 * Call this from a cron-like effect or a settings panel "Test reminder" button.
 */
export function useDepositReminder() {
  const checkAndDispatch = useCallback(
    async (contractId: string, poolId: string): Promise<boolean> => {
      try {
        const server = new rpc.Server(STELLAR_RPC_URL)

        // Build a simulation request for deposit_reminder_due (read-only view)
        const contract = new Contract(contractId)
        const tx = new (await import("@stellar/stellar-sdk")).TransactionBuilder(
          await server.getAccount(contractId),
          { fee: "100", networkPassphrase: STELLAR_NETWORK_PASSPHRASE }
        )
          .addOperation(contract.call("deposit_reminder_due"))
          .setTimeout(30)
          .build()

        const sim = await server.simulateTransaction(tx)
        if (rpc.Api.isSimulationError(sim)) return false

        const returnVal: xdr.ScVal | undefined = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval
        if (!returnVal) return false

        const isDue: boolean = scValToNative(returnVal)
        if (!isDue) return false

        // Insert activity row — triggers the notify-pool-event webhook
        await supabase.from("pool_activity").insert({
          pool_id: poolId,
          activity_type: "deposit_reminder",
          description: "Deposit reminder: round deadline approaching",
        })

        return true
      } catch {
        return false
      }
    },
    []
  )

  return { checkAndDispatch }
}
