// Unit tests for the pure CCTP bridge logic: attestation state machine and
// amount/rounding/balance handling.
import { test } from "node:test"
import assert from "node:assert"
import {
  advanceBridgeStatus,
  attestationUrl,
  ATTESTATION_SERVICE_URL,
  CCTP_CHAINS,
  CCTP_DESTINATION,
  explorerTxUrl,
  getCctpChainById,
  resolveAttestationPhase,
  usdcBaseToHuman,
  usdcHumanToBase,
  usdcScale,
  validateBridgeAmount,
  type AttestationRawStatus,
} from "./cctp-bridge"

// ── Chain metadata ───────────────────────────────────────────────────────────

test("CCTP source chains are exposed with their domains", () => {
  const ids = CCTP_CHAINS.map((c) => c.id)
  assert.ok(ids.includes("ethereum"))
  assert.ok(ids.includes("base"))
  assert.ok(ids.includes("arbitrum"))
  assert.ok(ids.includes("optimism"))
  assert.ok(ids.includes("polygon"))
})

test("getCctpChainById - finds and misses", () => {
  assert.strictEqual(getCctpChainById("base")?.name, "Base")
  assert.strictEqual(getCctpChainById("nope"), undefined)
  assert.strictEqual(getCctpChainById(null), undefined)
})

test("CCTP destination is Stellar with 7 USDC decimals", () => {
  assert.strictEqual(CCTP_DESTINATION.id, "stellar")
  assert.strictEqual(CCTP_DESTINATION.decimals, 7)
})

// ── Amount / rounding ────────────────────────────────────────────────────────

test("usdcHumanToBase - 6-decimal conversion is exact", () => {
  assert.strictEqual(usdcHumanToBase("125", 6), 125_000_000n)
  assert.strictEqual(usdcHumanToBase("0.5", 6), 500_000n)
  assert.strictEqual(usdcHumanToBase("0.123456", 6), 123_456n)
})

test("usdcHumanToBase - rejects more than 6 decimals", () => {
  assert.throws(() => usdcHumanToBase("0.1234567", 6), /exceeds 6 decimal places/)
})

test("usdcHumanToBase - rejects malformed input", () => {
  assert.throws(() => usdcHumanToBase("", 6))
  assert.throws(() => usdcHumanToBase("abc", 6))
  assert.throws(() => usdcHumanToBase("1.2.3", 6))
})

test("usdcBaseToHuman - round trip and trailing-zero trim", () => {
  assert.strictEqual(usdcBaseToHuman(500_000n, 6), "0.5")
  assert.strictEqual(usdcBaseToHuman(125_000_000n, 6), "125")
  assert.strictEqual(usdcBaseToHuman(123_456n, 6), "0.123456")
})

test("usdcScale - 10^decimals", () => {
  assert.strictEqual(usdcScale(6), 1_000_000n)
  assert.strictEqual(usdcScale(7), 10_000_000n)
})

// ── validateBridgeAmount ─────────────────────────────────────────────────────

test("validateBridgeAmount - passes with sufficient balance", () => {
  assert.strictEqual(validateBridgeAmount("1", 6, 2_000_000n), null)
})

test("validateBridgeAmount - fails with insufficient balance", () => {
  const err = validateBridgeAmount("1", 6, 500_000n)
  assert.ok(err && err.includes("Insufficient USDC balance"))
})

test("validateBridgeAmount - rejects zero and invalid amounts", () => {
  assert.ok(validateBridgeAmount("0", 6, 10n))
  assert.ok(validateBridgeAmount("abc", 6, 10n))
  assert.ok(validateBridgeAmount("0.1234567", 6, 10n))
})

// ── Attestation state machine ────────────────────────────────────────────────

test("resolveAttestationPhase - maps raw statuses to the simplified phase", () => {
  const pending: AttestationRawStatus[] = ["pending_confirmations", "pending_attestation"]
  const terminal: AttestationRawStatus[] = ["failure", "expired"]
  for (const s of pending) assert.strictEqual(resolveAttestationPhase(s), "pending")
  assert.strictEqual(resolveAttestationPhase("complete"), "complete")
  for (const s of terminal) assert.strictEqual(resolveAttestationPhase(s), "failure")
})

test("advanceBridgeStatus - pending -> attested on complete", () => {
  assert.strictEqual(advanceBridgeStatus("pending", "complete"), "attested")
})

test("advanceBridgeStatus - stays pending while attestation pending", () => {
  assert.strictEqual(advanceBridgeStatus("pending", "pending"), "pending")
})

test("advanceBridgeStatus - any state fails on a failure attestation", () => {
  assert.strictEqual(advanceBridgeStatus("pending", "failure"), "failed")
  assert.strictEqual(advanceBridgeStatus("attested", "failure"), "failed")
})

test("advanceBridgeStatus - terminal states never regress", () => {
  assert.strictEqual(advanceBridgeStatus("deposited", "pending"), "deposited")
  assert.strictEqual(advanceBridgeStatus("deposited", "failure"), "deposited")
  assert.strictEqual(advanceBridgeStatus("failed", "complete"), "failed")
})

// ── URLs ─────────────────────────────────────────────────────────────────────

test("attestationUrl builds from the service base", () => {
  assert.strictEqual(attestationUrl("abc123"), `${ATTESTATION_SERVICE_URL}/abc123`)
})

test("explorerTxUrl builds a tx link for a source chain", () => {
  const base = getCctpChainById("base")!
  assert.strictEqual(explorerTxUrl(base, "0xdead"), "https://basescan.org/tx/0xdead")
})
