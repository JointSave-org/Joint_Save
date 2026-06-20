export type ValidationResult = { valid: boolean; message: string }

const ok: ValidationResult = { valid: true, message: "" }
const err = (message: string): ValidationResult => ({ valid: false, message })

export function validateGroupName(value: string): ValidationResult {
  if (!value.trim()) return err("Group name is required")
  if (value.trim().length < 3) return err("Must be at least 3 characters")
  if (value.trim().length > 50) return err("Must be 50 characters or less")
  return ok
}

export function validateStellarAddress(value: string): ValidationResult {
  if (!value) return err("Stellar address is required")
  if (!value.startsWith("G")) return err("Stellar addresses start with 'G'")
  if (value.length !== 56) return err(`Address must be 56 characters (currently ${value.length})`)
  if (!/^G[A-Z2-7]{55}$/.test(value)) return err("Invalid characters — only A–Z and 2–7 allowed after 'G'")
  return ok
}

export function validatePositiveAmount(value: string, label = "Amount"): ValidationResult {
  if (!value) return err(`${label} is required`)
  const num = parseFloat(value)
  if (isNaN(num) || !isFinite(num)) return err(`${label} must be a valid number`)
  if (num <= 0) return err(`${label} must be greater than 0`)
  return ok
}

export function validateDeadline(value: string): ValidationResult {
  if (!value) return err("Deadline is required")
  const date = new Date(value)
  if (isNaN(date.getTime())) return err("Invalid date")
  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 1)
  if (date < minDate) return err("Deadline must be at least 1 day in the future")
  return ok
}

export function validateWithdrawalFee(value: string): ValidationResult {
  if (!value && value !== "0") return err("Withdrawal fee is required")
  const num = parseFloat(value)
  if (isNaN(num)) return err("Fee must be a number")
  if (num < 0) return err("Fee cannot be negative")
  if (num > 10) return err("Fee cannot exceed 10%")
  return ok
}
