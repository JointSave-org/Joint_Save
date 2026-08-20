/**
 * Maps raw Soroban contract error strings to user-friendly messages.
 *
 * Every `assert!()` in the Rust contracts emits a short string on failure.
 * This module normalises those strings into typed codes and human-readable
 * messages so the simulation dialog can display helpful feedback *before*
 * the user signs anything.
 */

// ── Error codes ──────────────────────────────────────────────────────────────

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
} as const

export type ContractErrorCode = (typeof ContractErrorCode)[keyof typeof ContractErrorCode]

// ── Friendly messages ────────────────────────────────────────────────────────

const FRIENDLY_MESSAGES: Record<ContractErrorCode, string> = {
  [ContractErrorCode.POOL_PAUSED]:
    "This pool is currently paused. Deposits are not accepted.",
  [ContractErrorCode.NOT_A_MEMBER]:
    "You are not a member of this pool.",
  [ContractErrorCode.ALREADY_DEPOSITED]:
    "You have already deposited for this round.",
  [ContractErrorCode.DEADLINE_PASSED]:
    "The deposit deadline has passed. Contact your pool admin.",
  [ContractErrorCode.DEADLINE_NOT_PASSED]:
    "The pool deadline has not passed yet. Refunds are not available at this time.",
  [ContractErrorCode.TARGET_NOT_REACHED]:
    "The pool target has not been reached yet. Withdrawals are locked.",
  [ContractErrorCode.NOTHING_TO_WITHDRAW]:
    "You have no balance to withdraw from this pool.",
  [ContractErrorCode.INSUFFICIENT_BALANCE]:
    "Your wallet balance is insufficient for this action.",
  [ContractErrorCode.INSUFFICIENT_POOL_BALANCE]:
    "The pool does not have enough funds for this action.",
  [ContractErrorCode.BELOW_MINIMUM_DEPOSIT]:
    "Your deposit is below the pool's minimum requirement.",
  [ContractErrorCode.UNAUTHORIZED]:
    "Only the pool admin can perform this action.",
  [ContractErrorCode.POOL_NOT_PAUSED]:
    "This pool is not currently paused.",
  [ContractErrorCode.ALREADY_A_MEMBER]:
    "This address is already a member of this pool.",
  [ContractErrorCode.POOL_INACTIVE]:
    "This pool is no longer active.",
  [ContractErrorCode.AMOUNT_MUST_BE_POSITIVE]:
    "The amount must be greater than zero.",
  [ContractErrorCode.YIELD_DISABLED]:
    "Yield distribution is not enabled for this pool.",
  [ContractErrorCode.TOKEN_NOT_SUPPORTED]:
    "This token is not supported by the pool.",
  [ContractErrorCode.POOL_UNLOCKED]:
    "The pool target has been reached. Use withdrawal instead.",
  [ContractErrorCode.UNKNOWN]:
    "Transaction would fail. No changes will be made.",
}

// ── Pattern matching table ───────────────────────────────────────────────────
// Each entry: [regex, code] — first match wins.

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
]

// ── Public API ───────────────────────────────────────────────────────────────

export interface ContractError {
  code: ContractErrorCode
  message: string
  raw: string
}

/**
 * Attempt to match a raw Soroban error string to a known contract error.
 *
 * Returns a `ContractError` with a typed code and a user-friendly message.
 * Unrecognised strings get `UNKNOWN` code with the original text appended.
 */
export function mapContractError(rawError: string): ContractError {
  for (const [pattern, code] of ERROR_PATTERNS) {
    if (pattern.test(rawError)) {
      return { code, message: FRIENDLY_MESSAGES[code], raw: rawError }
    }
  }
  return {
    code: ContractErrorCode.UNKNOWN,
    message: `Transaction would fail: ${rawError}`,
    raw: rawError,
  }
}
