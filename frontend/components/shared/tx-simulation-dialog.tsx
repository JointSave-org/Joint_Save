"use client"

import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { SimulationOutcome } from "@/lib/tx-simulator"
import { stroopsToXlm } from "@/lib/tx-simulator"

// ── Types ────────────────────────────────────────────────────────────────────

export interface TxSimulationDialogProps {
  /** Controls the open state of the dialog. */
  open: boolean
  /** Called when the user dismisses the dialog (X click, overlay, cancel). */
  onOpenChange: (open: boolean) => void
  /** The simulation result. `null` while the simulation is in-flight. */
  simulation: SimulationOutcome | null
  /** Whether the simulation RPC call is still pending. */
  isSimulating: boolean
  /** Called when the user clicks "Sign & Submit" after a successful simulation. */
  onConfirm: () => void
  /** Friendly label for the action being simulated (e.g. "Deposit", "Withdraw"). */
  txLabel?: string
}

// ── Component ────────────────────────────────────────────────────────────────

export function TxSimulationDialog({
  open,
  onOpenChange,
  simulation,
  isSimulating,
  onConfirm,
  txLabel = "Transaction",
}: TxSimulationDialogProps) {
  const phase: "simulating" | "success" | "failure" | "unavailable" = isSimulating
    ? "simulating"
    : simulation?.unavailable
      ? "unavailable"
      : simulation?.success
        ? "success"
        : "failure"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-background border border-border">
        <DialogHeader>
          <DialogTitle>{txLabel}</DialogTitle>
          <DialogDescription>
            {phase === "simulating" && "Simulating transaction on-chain…"}
            {phase === "success" && "Pre-flight check passed. Review below before signing."}
            {phase === "failure" && "This transaction would fail if submitted."}
            {phase === "unavailable" && "Simulation is unavailable."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Phase: Simulating ─────────────────────────────────────────── */}
        {phase === "simulating" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Checking transaction against the network…
            </p>
          </div>
        )}

        {/* ── Phase: Success ────────────────────────────────────────────── */}
        {phase === "success" && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-green-700">
                  Transaction looks good!
                </p>
                {simulation?.cost && (
                  <p className="text-sm text-green-600">
                    Estimated fee: {stroopsToXlm(simulation.cost.feeStroops)} XLM
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Sign the transaction in your wallet to submit it to the network.
            </p>
          </div>
        )}

        {/* ── Phase: Failure ────────────────────────────────────────────── */}
        {phase === "failure" && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  Transaction would fail
                </p>
                <p className="text-sm text-destructive/80">
                  {simulation?.friendlyMessage || "No changes will be made."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Phase: Unavailable ────────────────────────────────────────── */}
        {phase === "unavailable" && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-yellow-700">
                  Simulation unavailable
                </p>
                <p className="text-sm text-yellow-600">
                  The network could not be reached for pre-validation. The
                  transaction may fail on-chain.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSimulating}
          >
            {phase === "failure" ? "Close" : "Cancel"}
          </Button>

          {phase === "success" && (
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={onConfirm}
            >
              Sign &amp; Submit
            </Button>
          )}

          {phase === "unavailable" && (
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={onConfirm}
            >
              Proceed Anyway
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
