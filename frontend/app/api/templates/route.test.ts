import { test } from "node:test"
import assert from "node:assert"
import {
  validateTemplateName,
  validateTemplateDescription,
  isTemplatePoolType,
  isTemplateConfig,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
} from "@/lib/templates"

// ── validateTemplateName ─────────────────────────────────────────────────────

test("templates — name is required", () => {
  const result = validateTemplateName("")
  assert.strictEqual(result.valid, false)
  assert.strictEqual(result.message, "Template name is required")
})

test("templates — whitespace-only name is rejected", () => {
  const result = validateTemplateName("   ")
  assert.strictEqual(result.valid, false)
})

test("templates — non-string name is rejected", () => {
  const result = validateTemplateName(42)
  assert.strictEqual(result.valid, false)
})

test("templates — name over 50 chars is rejected", () => {
  const result = validateTemplateName("x".repeat(TEMPLATE_NAME_MAX_LENGTH + 1))
  assert.strictEqual(result.valid, false)
})

test("templates — 50-char name is accepted", () => {
  const result = validateTemplateName("x".repeat(TEMPLATE_NAME_MAX_LENGTH))
  assert.strictEqual(result.valid, true)
})

// ── validateTemplateDescription ──────────────────────────────────────────────

test("templates — null description is accepted", () => {
  const result = validateTemplateDescription(null)
  assert.strictEqual(result.valid, true)
})

test("templates — empty description is accepted", () => {
  const result = validateTemplateDescription("")
  assert.strictEqual(result.valid, true)
})

test("templates — description over 200 chars is rejected", () => {
  const result = validateTemplateDescription("y".repeat(TEMPLATE_DESCRIPTION_MAX_LENGTH + 1))
  assert.strictEqual(result.valid, false)
})

test("templates — 200-char description is accepted", () => {
  const result = validateTemplateDescription("y".repeat(TEMPLATE_DESCRIPTION_MAX_LENGTH))
  assert.strictEqual(result.valid, true)
})

test("templates — non-string description is rejected", () => {
  const result = validateTemplateDescription(123)
  assert.strictEqual(result.valid, false)
})

// ── isTemplatePoolType ───────────────────────────────────────────────────────

test("templates — valid pool types pass", () => {
  assert.strictEqual(isTemplatePoolType("rotational"), true)
  assert.strictEqual(isTemplatePoolType("target"), true)
  assert.strictEqual(isTemplatePoolType("flexible"), true)
})

test("templates — invalid pool types fail", () => {
  assert.strictEqual(isTemplatePoolType("other"), false)
  assert.strictEqual(isTemplatePoolType(""), false)
  assert.strictEqual(isTemplatePoolType(123), false)
  assert.strictEqual(isTemplatePoolType(null), false)
})

// ── isTemplateConfig ─────────────────────────────────────────────────────────

test("templates — plain object config passes", () => {
  assert.strictEqual(isTemplateConfig({ name: "pool", members: [] }), true)
})

test("templates — null/array/primitive configs fail", () => {
  assert.strictEqual(isTemplateConfig(null), false)
  assert.strictEqual(isTemplateConfig(undefined), false)
  assert.strictEqual(isTemplateConfig([]), false)
  assert.strictEqual(isTemplateConfig("config"), false)
  assert.strictEqual(isTemplateConfig(42), false)
})
