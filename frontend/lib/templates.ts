/**
 * Pool template system (issue #226).
 *
 * Users can save a pool creation configuration as a named template, browse
 * community-shared templates, and create a pool from a template with one
 * click. This module holds the shared types, config shape, and validation
 * used by the API routes, the templates page, and the creation forms.
 */

export const TEMPLATE_NAME_MAX_LENGTH = 50 as const
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 200 as const

export const TEMPLATE_POOL_TYPES = ["rotational", "target", "flexible"] as const
export type TemplatePoolType = (typeof TEMPLATE_POOL_TYPES)[number]

/**
 * Serialized pool creation parameters stored in `pool_templates.config`.
 * Mirrors the fields the pool creation forms submit, keyed the same way the
 * creation page's `DuplicatePrefill` expects them so a template can pre-fill
 * a form directly.
 */
export interface PoolTemplateConfig {
  name: string
  description: string | null
  poolType: TemplatePoolType
  /** Rotational: per-round contribution amount (string, matches form input). */
  amount?: string
  /** Target: total savings goal (string). */
  targetAmount?: string
  /** Flexible: minimum deposit per transaction (string). */
  minimumDeposit?: string
  /** Rotational payout frequency: daily | weekly | biweekly | monthly. */
  frequency?: string
  /** Flexible withdrawal fee in percent (string, 0–10). */
  withdrawalFee?: string
  /** Flexible yield generation toggle. */
  enableYield?: boolean
  /** Target deadline in days from creation (string). */
  deadlineDays?: string
  /** Member Stellar addresses (creator excluded — always implied). */
  members: string[]
  /** "XLM", "USDC", or a SEP-41 contract id. */
  token: string
}

export interface PoolTemplate {
  id: string
  creator_address: string
  name: string
  description: string | null
  pool_type: TemplatePoolType
  config: PoolTemplateConfig
  is_public: boolean
  use_count: number
  created_at: string
  updated_at: string
}

export function isTemplatePoolType(value: unknown): value is TemplatePoolType {
  return typeof value === "string" && (TEMPLATE_POOL_TYPES as readonly string[]).includes(value)
}

/** Template name is required and limited to 50 chars (mirrors pool names). */
export function validateTemplateName(name: unknown): { valid: boolean; message: string } {
  if (typeof name !== "string" || name.trim().length === 0) {
    return { valid: false, message: "Template name is required" }
  }
  if (name.length > TEMPLATE_NAME_MAX_LENGTH) {
    return {
      valid: false,
      message: `Template name cannot exceed ${TEMPLATE_NAME_MAX_LENGTH} characters`,
    }
  }
  return { valid: true, message: "" }
}

/** Template description is optional and limited to 200 chars. */
export function validateTemplateDescription(description: unknown): {
  valid: boolean
  message: string
} {
  if (description == null || description === "") return { valid: true, message: "" }
  if (typeof description !== "string") {
    return { valid: false, message: "Template description must be text" }
  }
  if (description.length > TEMPLATE_DESCRIPTION_MAX_LENGTH) {
    return {
      valid: false,
      message: `Template description cannot exceed ${TEMPLATE_DESCRIPTION_MAX_LENGTH} characters`,
    }
  }
  return { valid: true, message: "" }
}

/** The config must be a non-null object holding the pool creation parameters. */
export function isTemplateConfig(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
