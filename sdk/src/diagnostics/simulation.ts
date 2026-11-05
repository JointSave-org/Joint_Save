import { rpc } from "@stellar/stellar-sdk";

export interface SimulationEstimate {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  feeStroops: string;
}

/**
 * Summarizes simulation results into log-safe numeric metrics.
 * Explicitly strips all raw XDR payloads, transaction envelopes, and keys
 * to prevent leaking state or arguments into external logging systems.
 */
export function summarizeSimulation(
  simulation: rpc.Api.SimulateTransactionResponse
): SimulationEstimate {
  let instructions = 0;
  let readBytes = 0;
  let writeBytes = 0;
  let feeStroops = "0";

  if (rpc.Api.isSimulationSuccess(simulation)) {
    if (simulation.minResourceFee) {
      feeStroops = String(simulation.minResourceFee);
    }

    // Access resources safely across SDK versions / builder shapes
    const txData = simulation.transactionData as unknown as {
      resources?: () => {
        instructions: () => number;
        readBytes: () => number;
        writeBytes: () => number;
      };
      build?: () => {
        resources: () => {
          instructions: () => number;
          readBytes: () => number;
          writeBytes: () => number;
        };
      };
    } | undefined;

    if (txData) {
      try {
        const res = typeof txData.resources === "function" 
          ? txData.resources() 
          : typeof txData.build === "function" 
          ? txData.build().resources() 
          : undefined;

        if (res) {
          instructions = typeof res.instructions === "function" ? res.instructions() : Number(res.instructions || 0);
          readBytes = typeof res.readBytes === "function" ? res.readBytes() : Number(res.readBytes || 0);
          writeBytes = typeof res.writeBytes === "function" ? res.writeBytes() : Number(res.writeBytes || 0);
        }
      } catch {
        // Fallback to zeros if resources access fails
      }
    }
  }

  return {
    instructions,
    readBytes,
    writeBytes,
    feeStroops,
  };
}

export interface ContractErrorDiagnostic {
  contract?: string | undefined;
  method?: string | undefined;
  code: string;
  message: string;
  raw?: string | undefined;
}

/**
 * Known contract errors aligned with JointSave contracts and frontend taxonomy.
 */
const KNOWN_CODES: Record<string, string> = {
  pool_paused: "This pool is currently paused. Deposits are not accepted.",
  not_a_member: "You are not a member of this pool.",
  already_deposited: "You have already deposited for this round.",
  deadline_passed: "The deposit deadline has passed. Contact your pool admin.",
  deadline_not_passed: "The pool deadline has not passed yet. Refunds are not available at this time.",
  target_not_reached: "The pool target has not been reached yet. Withdrawals are locked.",
  nothing_to_withdraw: "You have no balance to withdraw from this pool.",
  insufficient_balance: "Your wallet balance is insufficient for this action.",
  insufficient_pool_balance: "The pool does not have enough funds for this action.",
  below_minimum: "Your deposit is below the pool's minimum requirement.",
  unauthorized: "Only the pool admin can perform this action.",
  not_admin: "Only the pool admin can perform this action.",
  pool_not_paused: "This pool is not currently paused.",
  already_a_member: "This address is already a member of this pool.",
  pool_inactive: "This pool is no longer active.",
  amount_must_be: "The amount must be greater than zero.",
  yield_disabled: "Yield distribution is not enabled for this pool.",
  token_not_supported: "This token is not supported by the pool.",
  pool_unlocked: "The pool target has been reached. Use withdrawal instead.",
};

/**
 * Classifies contract error strings or host diagnostics into stable typed diagnostics.
 */
export function classifyContractError(error: unknown): ContractErrorDiagnostic | null {
  if (!error) return null;

  const raw = error instanceof Error ? error.message : String(error);

  for (const [key, msg] of Object.entries(KNOWN_CODES)) {
    const regex = new RegExp(key.replace(/_/g, "\\s*"), "i");
    if (regex.test(raw)) {
      const normalizedCode = key.toUpperCase();
      return {
        code: normalizedCode,
        message: msg,
        raw,
      };
    }
  }

  // Check if it's a generic contract error
  if (/contract\s*error/i.test(raw) || /host\s*fn/i.test(raw) || /assert/i.test(raw)) {
    return {
      code: "UNKNOWN_CONTRACT_ERROR",
      message: `Transaction would fail: ${raw}`,
      raw,
    };
  }

  return null;
}
