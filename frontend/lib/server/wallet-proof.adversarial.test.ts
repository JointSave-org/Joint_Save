// Adversarial / mutation tests for the wallet-signature proof (issue #262 P3).
//
// The happy-path forgeries (wrong key, wrong pool, wrong action) are covered in
// wallet-proof.test.ts. These cases push the primitives where a subtle bug
// hides: flipped bytes, off-by-one signature lengths, tampered message bytes,
// non-string payloads, and timestamp edge values. The contract under test:
// "a proof only verifies for the exact address, exact message, and exact
// signature — any mutation anywhere is a refusal, never a panic."
import { test } from "node:test"
import assert from "node:assert"
import { createHash } from "node:crypto"
import { Keypair } from "@stellar/stellar-sdk"
import { checkWalletProof, verifySignedMessage } from "./wallet-proof"
import {
  archivePoolMessage,
  PROOF_MAX_AGE_MS,
  proofIsFresh,
  revokePauseAuthorizationMessage,
} from "../wallet-proof"

const PREFIX = "Stellar Signed Message:\n"

/** SEP-53 framing: ed25519 over SHA-256 of the prefixed message. */
function signDigest(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([Buffer.from(PREFIX, "utf8"), Buffer.from(message, "utf8")])
  return keypair.sign(createHash("sha256").update(payload).digest()).toString("base64")
}

/** The alternate framing some wallets produce: ed25519 over the prefixed bytes directly. */
function signRaw(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([Buffer.from(PREFIX, "utf8"), Buffer.from(message, "utf8")])
  return keypair.sign(payload).toString("base64")
}

// ── Signature mutation ───────────────────────────────────────────────────────

test("mutation: a single flipped byte in the signature breaks the proof", () => {
  const admin = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())
  const good = signDigest(admin, message)
  const raw = Buffer.from(good, "base64")
  assert.strictEqual(raw.length, 64)

  // Flip each of the first 8 + middle + last bytes of the signature. ed25519
  // has no malleable encodings: one altered byte must fail verification.
  const positions = [0, 1, 7, 8, 31, 32, 63]
  for (const pos of positions) {
    const corrupted = Buffer.from(raw)
    corrupted[pos] ^= 0x01
    assert.strictEqual(
      verifySignedMessage(admin.publicKey(), message, corrupted.toString("base64")),
      false,
      `signature with flipped byte at ${pos} must not verify`
    )
  }
  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, good), true)
})

test("mutation: signatures of the wrong length are refused, not thrown on", () => {
  const admin = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())

  // 63 and 65 bytes are invalid ed25519 signatures and must be refused.
  const short = Buffer.from(signDigest(admin, message), "base64").subarray(0, 63)
  const long = Buffer.concat([Buffer.from(signDigest(admin, message), "base64"), Buffer.from([0x00])])
  assert.strictEqual(
    verifySignedMessage(admin.publicKey(), message, short.toString("base64")),
    false
  )
  assert.strictEqual(
    verifySignedMessage(admin.publicKey(), message, long.toString("base64")),
    false
  )
  // Empty base64 string (0 bytes) is refused.
  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, ""), false)
})

test("mutation: concatenated duplicates of a valid signature are refused", () => {
  // If a verifier naively allowed >64 bytes or concatenated signatures, a
  // doubled signature would pass. This pins the strict 64-byte contract.
  const admin = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())
  const sig = Buffer.from(signDigest(admin, message), "base64")
  const doubled = Buffer.concat([sig, sig])
  assert.strictEqual(
    verifySignedMessage(admin.publicKey(), message, doubled.toString("base64")),
    false
  )
})

// ── Message mutation ─────────────────────────────────────────────────────────

test("mutation: any byte change to the signed message breaks the proof", () => {
  const admin = Keypair.random()
  const signedAt = Date.now()
  const message = revokePauseAuthorizationMessage("auth-1", signedAt)
  const signature = signDigest(admin, message)

  const mutations: string[] = [
    message.replace("revoke pause authorization", "revoke pause authorisation"),
    message.replace("authorization: auth-1", "authorization: auth-2"),
    message.replace(`at: ${signedAt}`, `at: ${signedAt + 1}`),
    `${message}\n`, // trailing newline
    message.replace("JointSave:", "JointSave :"),
    message.replace("Signing this does not move funds.", "Signing this moves funds."),
  ]
  for (const mutated of mutations) {
    assert.strictEqual(
      verifySignedMessage(admin.publicKey(), mutated, signature),
      false,
      `mutated message must not verify: ${JSON.stringify(mutated)}`
    )
  }
})

test("mutation: reordering the signed lines breaks the proof", () => {
  const admin = Keypair.random()
  const signedAt = Date.now()
  const signature = signDigest(admin, revokePauseAuthorizationMessage("auth-1", signedAt))

  const reordered = `JointSave: revoke pause authorization
at: ${signedAt}
authorization: auth-1
Signing this does not move funds.`
  assert.strictEqual(verifySignedMessage(admin.publicKey(), reordered, signature), false)
})

test("mutation: prefix confusion is refused on both framings", () => {
  const admin = Keypair.random()
  const signedAt = Date.now()
  const base = revokePauseAuthorizationMessage("auth-1", signedAt)

  // Attacker embeds a prefix-looking line so the wallet thinks it signs a
  // double-prefixed payload. The canonical message (single prefix) must not
  // accept a signature made over the doubly-prefixed bytes.
  const poisoned = `${PREFIX}${base}`
  const sigOverPoisoned = signDigest(admin, poisoned)
  assert.strictEqual(verifySignedMessage(admin.publicKey(), base, sigOverPoisoned), false)

  // And the reverse direction on the raw framing.
  const sigRawOverPoisoned = signRaw(admin, poisoned)
  assert.strictEqual(verifySignedMessage(admin.publicKey(), base, sigRawOverPoisoned), false)
})

test("mutation: an address with a swapped character refuses a valid signature", () => {
  const admin = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())
  const signature = signDigest(admin, message)

  // StrKey addresses are base32 with a checksum; swapping a letter at the tail
  // keeps most of the string intact but produces a different account.
  const pub = admin.publicKey()
  const tampered = pub.slice(0, -1) + (pub.endsWith("A") ? "B" : "A")
  if (tampered !== pub) {
    assert.strictEqual(verifySignedMessage(tampered, message, signature), false)
  }
})

// ── Fail-open inputs ─────────────────────────────────────────────────────────

test("fail-open: checkWalletProof never throws on hostile payloads", () => {
  const admin = Keypair.random()
  const signedAt = Date.now()
  const message = revokePauseAuthorizationMessage("auth-1", signedAt)
  const signature = signDigest(admin, message)

  const hostile: Array<{
    signature?: unknown
    signedAt?: unknown
    address?: unknown
  }> = [
    { signature: 12345, signedAt }, // number signature
    { signature: { sig: signature }, signedAt }, // object signature
    { signature: ["a", "b"], signedAt }, // array signature
    { signature: null, signedAt }, // null signature
    { signature: undefined, signedAt }, // missing signature
    { signature: true, signedAt }, // boolean signature
    { signature, signedAt: undefined }, // missing timestamp
    { signature, signedAt: null }, // null timestamp
    { signature, signedAt: "not-a-number" }, // junk timestamp
    { signature, signedAt: Infinity }, // Infinity timestamp
    { signature, signedAt: -Infinity },
    { signature, signedAt: Number.NaN },
    { signature, signedAt: 0 },
    { signature, signedAt: -PROOF_MAX_AGE_MS - 1 }, // far past
    { signature, signedAt: PROOF_MAX_AGE_MS + 1 }, // far future
    { signature, signedAt }, // valid baseline
  ]

  for (const [i, payload] of hostile.entries()) {
    const result = checkWalletProof({
      address: admin.publicKey(),
      message,
      ...payload,
    } as never)
    assert.strictEqual(typeof result.ok, "boolean", `case ${i} must return a boolean`)
    if (i < hostile.length - 1) {
      assert.strictEqual(result.ok, false, `case ${i} must be refused`)
    } else {
      assert.strictEqual(result.ok, true, `case ${i} (baseline) must pass`)
    }
  }
})

test("fail-open: numeric string timestamps still work, text ones do not", () => {
  const admin = Keypair.random()
  const signedAt = Date.now()
  const message = revokePauseAuthorizationMessage("auth-1", signedAt)
  const signature = signDigest(admin, message)

  // JSON-safe numeric string (what most wallets send) is coerced fine.
  assert.strictEqual(
    checkWalletProof({
      address: admin.publicKey(),
      message,
      signature,
      signedAt: String(signedAt),
    }).ok,
    true
  )
  // A timestamp that parses clean but is far off is stale, not accepted.
  assert.strictEqual(
    checkWalletProof({
      address: admin.publicKey(),
      message,
      signature,
      signedAt: String(signedAt - PROOF_MAX_AGE_MS - 5_000),
    }).ok,
    false
  )
})

// ── Replay / timestamp abuse ─────────────────────────────────────────────────

test("replay: a fresh-looking timestamp injected into a captured proof fails", () => {
  // An attacker captures a valid proof, then tries to replay it with a
  // *fresh* signedAt so freshness passes. Because signedAt is part of the
  // signed message, the signature no longer matches the new message.
  const admin = Keypair.random()
  const oldSignedAt = Date.now() - 60_000
  const captured = signDigest(admin, revokePauseAuthorizationMessage("auth-1", oldSignedAt))

  const freshSignedAt = Date.now()
  const result = checkWalletProof({
    address: admin.publicKey(),
    message: revokePauseAuthorizationMessage("auth-1", freshSignedAt),
    signature: captured,
    signedAt: freshSignedAt,
  })
  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /does not match/)
})

test("replay: a proof reused verbatim is only good while fresh", () => {
  // Replaying the *exact* captured (message, signature, signedAt) triple is
  // unavoidable without a server-side nonce — but it stops working once the
  // timestamp ages out, which is the point of PROOF_MAX_AGE_MS.
  const admin = Keypair.random()
  const now = Date.now()
  const message = archivePoolMessage("pool-1", now)
  const signature = signDigest(admin, message)

  assert.strictEqual(
    checkWalletProof({
      address: admin.publicKey(),
      message,
      signature,
      signedAt: now,
    }).ok,
    true
  )
  // Advance the clock past the window.
  const stale = now - (PROOF_MAX_AGE_MS + 1_000)
  assert.strictEqual(proofIsFresh(stale), false)
  assert.strictEqual(
    checkWalletProof({
      address: admin.publicKey(),
      message,
      signature,
      signedAt: stale,
    }).ok,
    false
  )
})

// ── Timing edges ─────────────────────────────────────────────────────────────

test("timing: the freshness window is inclusive at the boundary", () => {
  const now = Date.now()
  assert.strictEqual(proofIsFresh(now - PROOF_MAX_AGE_MS, now), true)
  assert.strictEqual(proofIsFresh(now + PROOF_MAX_AGE_MS, now), true)
  assert.strictEqual(proofIsFresh(now - PROOF_MAX_AGE_MS - 1, now), false)
  assert.strictEqual(proofIsFresh(now + PROOF_MAX_AGE_MS + 1, now), false)
})

// ── Framing equivalence ──────────────────────────────────────────────────────

test("framing: both SEP-53 framings are accepted, and both are bound to the message", () => {
  const admin = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())

  const digestSig = signDigest(admin, message)
  const rawSig = signRaw(admin, message)
  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, digestSig), true)
  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, rawSig), true)

  // Neither framing transfers to a different message.
  const other = revokePauseAuthorizationMessage("auth-2", Date.now())
  assert.strictEqual(verifySignedMessage(admin.publicKey(), other, digestSig), false)
  assert.strictEqual(verifySignedMessage(admin.publicKey(), other, rawSig), false)
})