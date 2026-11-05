import { JointSaveError } from "../errors";

/**
 * Stable contract error codes.
 *
 * Mirrors `frontend/lib/contract-errors.ts` so SDK and app produce the same
 * taxonomy for the same on-chain `assert!()` strings.
 */
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

export type ContractErrorCode =
  (typeof ContractErrorCode)[keyof typeof ContractErrorCode];

/** Stable, log-safe description of a contract failure. */
export interface ContractErrorDiagnostic {
  contract?: string | undefined;
  method?: string | undefined;
  code: ContractErrorCode;
  message: string;
  /** Original (unredacted) error text, when one could be extracted. */
  raw?: string | undefined;
}

const FRIENDLY_MESSAGES: Record<ContractErrorCode, string> = {
  POOL_PAUSED: "This pool is currently paused. Deposits are not accepted.",
  NOT_A_MEMBER: "You are not a member of this pool.",
  ALREADY_DEPOSITED: "You have already deposited for this round.",
  DEADLINE_PASSED: "The deposit deadline has passed. Contact your pool admin.",
  DEADLINE_NOT_PASSED:
    "The pool deadline has not passed yet. Refunds are not available at this time.",
  TARGET_NOT_REACHED:
    "The pool target has not been reached yet. Withdrawals are locked.",
  NOTHING_TO_WITHDRAW: "You have no balance to withdraw from this pool.",
  INSUFFICIENT_BALANCE: "Your wallet balance is insufficient for this action.",
  INSUFFICIENT_POOL_BALANCE: "The pool does not have enough funds for this action.",
  BELOW_MINIMUM_DEPOSIT: "Your deposit is below the pool's minimum requirement.",
  UNAUTHORIZED: "Only the pool admin can perform this action.",
  POOL_NOT_PAUSED: "This pool is not currently paused.",
  ALREADY_A_MEMBER: "This address is already a member of this pool.",
  POOL_INACTIVE: "This pool is no longer active.",
  AMOUNT_MUST_BE_POSITIVE: "The amount must be greater than zero.",
  YIELD_DISABLED: "Yield distribution is not enabled for this pool.",
  TOKEN_NOT_SUPPORTED: "This token is not supported by the pool.",
  POOL_UNLOCKED: "The pool target has been reached. Use withdrawal instead.",
  UNKNOWN: "Transaction would fail. No changes will be made.",
};

const ERROR_PATTERNS: [RegExp, ContractErrorCode][] = [
  [/pool\s*not\s*paused/i, "POOL_NOT_PAUSED"],
  [/paused/i, "POOL_PAUSED"],
  [/not\s*a\s*member/i, "NOT_A_MEMBER"],
  [/already\s*a\s*member/i, "ALREADY_A_MEMBER"],
  [/already\s*deposited/i, "ALREADY_DEPOSITED"],
  [/deadline\s*not\s*passed/i, "DEADLINE_NOT_PASSED"],
  [/deadline.*passed/i, "DEADLINE_PASSED"],
  [/target\s*not\s*reached/i, "TARGET_NOT_REACHED"],
  [/nothing\s*to\s*withdraw/i, "NOTHING_TO_WITHDRAW"],
  [/insufficient\s*pool\s*balance/i, "INSUFFICIENT_POOL_BALANCE"],
  [/insufficient\s*balance/i, "INSUFFICIENT_BALANCE"],
  [/below\s*minimum/i, "BELOW_MINIMUM_DEPOSIT"],
  [/not\s*admin|not\s*authorized/i, "UNAUTHORIZED"],
  [/pool\s*inactive/i, "POOL_INACTIVE"],
  [/amount\s*must\s*be/i, "AMOUNT_MUST_BE_POSITIVE"],
  [/yield\s*disabled/i, "YIELD_DISABLED"],
  [/token\s*not\s*supported/i, "TOKEN_NOT_SUPPORTED"],
  [/pool\s*unlocked/i, "POOL_UNLOCKED"],
];

/** Map a raw Soroban/contract error string to a stable diagnostic. */
export function mapContractError(rawError: string): ContractErrorDiagnostic {
  for (const [pattern, code] of ERROR_PATTERNS) {
    if (pattern.test(rawError)) {
      return { code, message: FRIENDLY_MESSAGES[code], raw: rawError };
    }
  }
  return {
    code: "UNKNOWN",
    message: `Transaction would fail: ${rawError}`,
    raw: rawError,
  };
}

interface ExtractedError {
  raw: string;
  contract?: string | undefined;
  method?: string | undefined;
  wasSimulation: boolean;
}

function extractError(error: unknown): ExtractedError {
  if (error instanceof JointSaveError) {
    const cause =
      error.cause instanceof Error ? ` ${error.cause.message}` : "";
    return {
      raw: `${error.message}${cause}`.trim(),
      contract: error.contract,
      method: error.method,
      wasSimulation: error.code === "SIMULATION_FAILED",
    };
  }
  if (error instanceof Error) {
    const context = error as Error & { contract?: unknown; method?: unknown; cause?: unknown };
    const cause = context.cause instanceof Error ? ` ${context.cause.message}` : "";
    return {
      raw: `${error.message}${cause}`.trim(),
      contract: typeof context.contract === "string" ? context.contract : undefined,
      method: typeof context.method === "string" ? context.method : undefined,
      wasSimulation: /simulation/i.test(error.message),
    };
  }
  if (typeof error === "string") {
    return { raw: error, wasSimulation: /simulation/i.test(error) };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const raw =
      typeof value.message === "string"
        ? value.message
        : typeof value.error === "string"
          ? value.error
          : "";
    return {
      raw,
      contract: typeof value.contract === "string" ? value.contract : undefined,
      method: typeof value.method === "string" ? value.method : undefined,
      wasSimulation: /simulation/i.test(raw),
    };
  }
  return { raw: "", wasSimulation: false };
}

function looksLikeContractError(raw: string, wasSimulation: boolean): boolean {
  return (
    wasSimulation ||
    /contract|host|wasm|soroban|Error\(Contract/i.test(raw) ||
    /assert|panicked|unreachable/i.test(raw)
  );
}

/**
 * Classify an arbitrary thrown value as a contract diagnostic.
 *
 * Returns `null` for non-contract failures (validation, signer rejection,
 * plain network errors) so callers can fall back to retry/transport handling.
 */
export function classifyContractError(error: unknown): ContractErrorDiagnostic | null {
  const extracted = extractError(error);
  if (!extracted.raw) return null;

  const mapped = mapContractError(extracted.raw);
  const isKnown = mapped.code !== "UNKNOWN";
  if (!isKnown && !looksLikeContractError(extracted.raw, extracted.wasSimulation)) {
    return null;
  }

  const diagnostic: ContractErrorDiagnostic = {
    code: mapped.code,
    message: mapped.message,
    raw: mapped.raw,
  };
  if (extracted.contract !== undefined) diagnostic.contract = extracted.contract;
  if (extracted.method !== undefined) diagnostic.method = extracted.method;
  return diagnostic;
}
