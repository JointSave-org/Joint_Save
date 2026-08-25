import { StrKey } from "@stellar/stellar-sdk"

export type ValidationResult = { valid: boolean; message: string }

const ok: ValidationResult = { valid: true, message: "" }
const err = (message: string): ValidationResult => ({ valid: false, message })

/**
 * Optional pre-translated message overrides. Every field is optional and
 * falls back to the English default — callers without translation context
 * (the digest-preferences API route, this module's own unit test) keep
 * working unchanged.
 */
export interface ValidationMessages {
  groupNameRequired?: string
  groupNameTooShort?: string
  groupNameTooLong?: string
  addressRequired?: string
  addressMustStartWithG?: string
  addressWrongLength?: (length: number) => string
  addressInvalidChars?: string
  addressInvalidChecksum?: string
  amountRequired?: (label: string) => string
  amountInvalidNumber?: (label: string) => string
  amountMustBePositive?: (label: string) => string
  deadlineRequired?: string
  deadlineInvalid?: string
  deadlineTooSoon?: string
  feeRequired?: string
  feeInvalidNumber?: string
  feeNegative?: string
  feeTooHigh?: string
  emailRequired?: string
  emailInvalid?: string
}

export function validateGroupName(value: string, messages?: ValidationMessages): ValidationResult {
  if (!value.trim()) return err(messages?.groupNameRequired ?? "Group name is required")
  if (value.trim().length < 3)
    return err(messages?.groupNameTooShort ?? "Must be at least 3 characters")
  if (value.trim().length > 50)
    return err(messages?.groupNameTooLong ?? "Must be 50 characters or less")
  return ok
}

export function validateStellarAddress(
  value: string,
  messages?: ValidationMessages
): ValidationResult {
  if (!value) return err(messages?.addressRequired ?? "Stellar address is required")
  if (!value.startsWith("G"))
    return err(messages?.addressMustStartWithG ?? "Stellar addresses start with 'G'")
  if (value.length !== 56)
    return err(
      messages?.addressWrongLength?.(value.length) ??
        `Address must be 56 characters (currently ${value.length})`
    )
  if (!/^G[A-Z2-7]{55}$/.test(value))
    return err(
      messages?.addressInvalidChars ?? "Invalid characters — only A–Z and 2–7 allowed after 'G'"
    )
  // Full StrKey check including the CRC16 checksum. Length + charset alone let
  // typos through, and an invalid address crashes downstream ScVal encoding
  // (nativeToScVal → new Address throws) instead of failing gracefully.
  if (!StrKey.isValidEd25519PublicKey(value))
    return err(messages?.addressInvalidChecksum ?? "Invalid Stellar address checksum")
  return ok
}

export function validatePositiveAmount(
  value: string,
  label = "Amount",
  messages?: ValidationMessages
): ValidationResult {
  if (!value) return err(messages?.amountRequired?.(label) ?? `${label} is required`)
  const num = parseFloat(value)
  if (isNaN(num) || !isFinite(num))
    return err(messages?.amountInvalidNumber?.(label) ?? `${label} must be a valid number`)
  if (num <= 0)
    return err(messages?.amountMustBePositive?.(label) ?? `${label} must be greater than 0`)
  return ok
}

export function validateDeadline(value: string, messages?: ValidationMessages): ValidationResult {
  if (!value) return err(messages?.deadlineRequired ?? "Deadline is required")
  const date = new Date(value)
  if (isNaN(date.getTime())) return err(messages?.deadlineInvalid ?? "Invalid date")
  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 1)
  if (date < minDate)
    return err(messages?.deadlineTooSoon ?? "Deadline must be at least 1 day in the future")
  return ok
}

export function validateWithdrawalFee(
  value: string,
  messages?: ValidationMessages
): ValidationResult {
  if (!value && value !== "0") return err(messages?.feeRequired ?? "Withdrawal fee is required")
  const num = parseFloat(value)
  if (isNaN(num)) return err(messages?.feeInvalidNumber ?? "Fee must be a number")
  if (num < 0) return err(messages?.feeNegative ?? "Fee cannot be negative")
  if (num > 10) return err(messages?.feeTooHigh ?? "Fee cannot exceed 10%")
  return ok
}

/**
 * Returns the indices of entries in `addresses` that share a value with at
 * least one other entry (both the first and later occurrences are flagged,
 * so every duplicate row can show an inline error). Empty entries are
 * ignored since they're caught by other field validation.
 */
export function findDuplicateAddresses(addresses: string[]): Set<number> {
  const firstSeenAt = new Map<string, number>()
  const duplicates = new Set<number>()
  addresses.forEach((raw, i) => {
    const value = raw.trim()
    if (!value) return
    const seenAt = firstSeenAt.get(value)
    if (seenAt !== undefined) {
      duplicates.add(seenAt)
      duplicates.add(i)
    } else {
      firstSeenAt.set(value, i)
    }
  })
  return duplicates
}

export function validateEmail(value: string, messages?: ValidationMessages): ValidationResult {
  if (!value.trim()) return err(messages?.emailRequired ?? "Email is required")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    return err(messages?.emailInvalid ?? "Enter a valid email address")
  return ok
}
