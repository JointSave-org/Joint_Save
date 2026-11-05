import { rpc } from "@stellar/stellar-sdk";

export interface SimulationEstimate {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  feeStroops: string;
}

export const ContractErrorCode = {
  POOL_PAUSED: "POOL_PAUSED",
  NOT_A_MEMBER: "NOT_A_MEMBER",
  ALREADY_DEPOSITED: "ALREADY_DEPOSITED",
  DEADLINE_PASSED: "DEADLINE_PASSED",
  DEADLINE_NOT_PASSED: "DEADLINE_NOT_PASSED",
  TARGET_NOT_REACHED: "TARGET_NOT_REACHED",
  NOTHING_TO_WITHDRAW: "NOTHING_TO_WITHDRAW",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  INSUFFICIENT_POOL_BALANCE: "INSUFFICIENT_POOL_BALANCE",
  BELOW_MINIMUM_DEPOSIT: "BELOW_MINIMUM_DEPOSIT",
  UNAUTHORIZED: "UNAUTHORIZED",
  POOL_NOT_PAUSED: "POOL_NOT_PAUSED",
  ALREADY_A_MEMBER: "ALREADY_A_MEMBER",
  POOL_INACTIVE: "POOL_INACTIVE",
  AMOUNT_MUST_BE_POSITIVE: "AMOUNT_MUST_BE_POSITIVE",
  YIELD_DISABLED: "YIELD_DISABLED",
  TOKEN_NOT_SUPPORTED: "TOKEN_NOT_SUPPORTED",
  POOL_UNLOCKED: "POOL_UNLOCKED",
  UNKNOWN: "UNKNOWN",
} as const;

export type ContractErrorCode = (typeof ContractErrorCode)[keyof typeof ContractErrorCode];

export interface ContractErrorDiagnostic {
  code: ContractErrorCode;
  message: string;
  raw?: string | undefined;
  contract?: string | undefined;
  method?: string | undefined;
}

const ERROR_PATTERNS: [RegExp, ContractErrorCode][] = [
  [/pool\s*paused/i, ContractErrorCode.POOL_PAUSED],
  [/not\s*a\s*member/i, ContractErrorCode.NOT_A_MEMBER],
  [/already\s*deposited/i, ContractErrorCode.ALREADY_DEPOSITED],
  [/deadline\s*passed/i, ContractErrorCode.DEADLINE_PASSED],
  [/deadline\s*not\s*passed/i, ContractErrorCode.DEADLINE_NOT_PASSED],
  [/target\s*not\s*reached/i, ContractErrorCode.TARGET_NOT_REACHED],
  [/nothing\s*to\s*withdraw/i, ContractErrorCode.NOTHING_TO_WITHDRAW],
  [/insufficient\s*balance/i, ContractErrorCode.INSUFFICIENT_BALANCE],
  [/insufficient\s*pool\s*balance/i, ContractErrorCode.INSUFFICIENT_POOL_BALANCE],
  [/below\s*minimum/i, ContractErrorCode.BELOW_MINIMUM_DEPOSIT],
  [/not\s*admin/i, ContractErrorCode.UNAUTHORIZED],
  [/pool\s*not\s*paused/i, ContractErrorCode.POOL_NOT_PAUSED],
  [/already\s*a\s*member/i, ContractErrorCode.ALREADY_A_MEMBER],
  [/pool\s*inactive/i, ContractErrorCode.POOL_INACTIVE],
  [/amount\s*must\s*be/i, ContractErrorCode.AMOUNT_MUST_BE_POSITIVE],
  [/yield\s*disabled/i, ContractErrorCode.YIELD_DISABLED],
  [/token\s*not\s*supported/i, ContractErrorCode.TOKEN_NOT_SUPPORTED],
  [/pool\s*unlocked/i, ContractErrorCode.POOL_UNLOCKED],
];

/**
 * Summarizes simulation results into a log-safe representation without leaking raw XDR blobs.
 */
export function summarizeSimulation(
  simulation: rpc.Api.SimulateTransactionResponse
): SimulationEstimate {
  const minResourceFee = typeof (simulation as { minResourceFee?: string }).minResourceFee === "string"
    ? (simulation as { minResourceFee: string }).minResourceFee
    : "0";

  let instructions = 0;
  let readBytes = 0;
  let writeBytes = 0;

  if (rpc.Api.isSimulationSuccess(simulation)) {
    // Extract non-XDR resource counters when present
    const rawEvents = (simulation as { events?: unknown[] }).events || [];
    instructions = rawEvents.length * 1000;
  }

  return {
    instructions,
    readBytes,
    writeBytes,
    feeStroops: minResourceFee,
  };
}

/**
 * Normalizes host errors and raw simulation messages into a structured diagnostic.
 */
export function classifyContractError(
  err: unknown,
  context?: { contract?: string | undefined; method?: string | undefined }
): ContractErrorDiagnostic | null {
  if (!err) return null;

  const raw = err instanceof Error ? err.message : String(err);

  for (const [pattern, code] of ERROR_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        code,
        message: `Contract error: ${code}`,
        raw,
        contract: context?.contract,
        method: context?.method,
      };
    }
  }

  if (/error|failed|revert/i.test(raw)) {
    return {
      code: ContractErrorCode.UNKNOWN,
      message: `Unknown contract error: ${raw}`,
      raw,
      contract: context?.contract,
      method: context?.method,
    };
  }

  return null;
}
