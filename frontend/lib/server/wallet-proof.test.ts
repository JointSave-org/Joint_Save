// Unit tests for the wallet-signature proof.
//
// This is what stands between a public pool id and someone disarming a pool's
// automatic pause, so the cases that matter are the forgeries: another key, a
// different authorization, a stale timestamp.
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
  unarchivePoolMessage,
} from "../wallet-proof"

/** Signs the way SEP-53 specifies: ed25519 over SHA-256 of the prefixed message. */
function sign(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([
    Buffer.from("Stellar Signed Message:\n", "utf8"),
    Buffer.from(message, "utf8"),
  ])
  return keypair.sign(createHash("sha256").update(payload).digest()).toString("base64")
}

test("proof: a signature from the right key is accepted", () => {
  const admin = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())

  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, sign(admin, message)), true)
})

test("proof: a signature from another key is refused", () => {
  const admin = Keypair.random()
  const attacker = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())

  assert.strictEqual(
    verifySignedMessage(admin.publicKey(), message, sign(attacker, message)),
    false
  )
})

test("proof: a signature for a different authorization does not transfer", () => {
  // Otherwise revoking one pool's authorization would revoke another's.
  const admin = Keypair.random()
  const now = Date.now()
  const signature = sign(admin, revokePauseAuthorizationMessage("auth-1", now))

  assert.strictEqual(
    verifySignedMessage(
      admin.publicKey(),
      revokePauseAuthorizationMessage("auth-2", now),
      signature
    ),
    false
  )
})

test("proof: garbage signatures and addresses are refused, not thrown on", () => {
  const admin = Keypair.random()
  const message = revokePauseAuthorizationMessage("auth-1", Date.now())

  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, "not-base64!!"), false)
  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, ""), false)
  assert.strictEqual(verifySignedMessage("not-an-address", message, sign(admin, message)), false)
})

test("freshness: accepts now, rejects beyond the window on either side", () => {
  const now = Date.now()

  assert.strictEqual(proofIsFresh(now, now), true)
  assert.strictEqual(proofIsFresh(now - PROOF_MAX_AGE_MS + 1000, now), true)
  assert.strictEqual(proofIsFresh(now - PROOF_MAX_AGE_MS - 1000, now), false)
  // A clock ahead of the server is just as suspect as one behind it.
  assert.strictEqual(proofIsFresh(now + PROOF_MAX_AGE_MS + 1000, now), false)
  assert.strictEqual(proofIsFresh(Number.NaN, now), false)
})

test("check: a complete, fresh proof passes", () => {
  const admin = Keypair.random()
  const signedAt = Date.now()
  const message = revokePauseAuthorizationMessage("auth-1", signedAt)

  const result = checkWalletProof({
    address: admin.publicKey(),
    message,
    signature: sign(admin, message),
    signedAt,
  })
  assert.strictEqual(result.ok, true, result.reason)
})

test("check: a missing signature is refused with a usable message", () => {
  const admin = Keypair.random()
  const signedAt = Date.now()

  const result = checkWalletProof({
    address: admin.publicKey(),
    message: revokePauseAuthorizationMessage("auth-1", signedAt),
    signature: undefined,
    signedAt,
  })
  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /signature is required/)
})

test("check: a captured proof stops working once it goes stale", () => {
  const admin = Keypair.random()
  const signedAt = Date.now() - PROOF_MAX_AGE_MS - 60_000
  const message = revokePauseAuthorizationMessage("auth-1", signedAt)

  const result = checkWalletProof({
    address: admin.publicKey(),
    message,
    signature: sign(admin, message),
    signedAt,
  })
  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /too old/)
})

test("check: a valid signature from the wrong account is refused", () => {
  // The endpoint checks against the pool's admin as recorded, so an attacker
  // signing with their own key gets nowhere even with a well-formed request.
  const attacker = Keypair.random()
  const poolAdmin = Keypair.random()
  const signedAt = Date.now()
  const message = revokePauseAuthorizationMessage("auth-1", signedAt)

  const result = checkWalletProof({
    address: poolAdmin.publicKey(),
    message,
    signature: sign(attacker, message),
    signedAt,
  })
  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /does not match/)
})

// ── Archiving ───────────────────────────────────────────────────────────────
//
// A pool id and its creator's address are both public, so the archive and
// unarchive endpoints cannot treat an address in a request body as evidence.
// These pin the two properties the fix depends on.

test("archive: the pool admin's own signature is accepted", () => {
  const admin = Keypair.random()
  const message = archivePoolMessage("pool-1", Date.now())

  assert.strictEqual(verifySignedMessage(admin.publicKey(), message, sign(admin, message)), true)
})

test("archive: naming the admin's address does not archive their pool", () => {
  // The whole bug this closes: the caller supplies admin_address, so anybody
  // can claim to be the creator. Only the signature settles it.
  const admin = Keypair.random()
  const attacker = Keypair.random()
  const message = archivePoolMessage("pool-1", Date.now())

  assert.strictEqual(
    checkWalletProof({
      address: admin.publicKey(),
      message,
      signature: sign(attacker, message),
      signedAt: Date.now(),
    }).ok,
    false
  )
})

test("archive: a proof for one pool does not archive another", () => {
  const admin = Keypair.random()
  const now = Date.now()
  const signature = sign(admin, archivePoolMessage("pool-1", now))

  assert.strictEqual(
    verifySignedMessage(admin.publicKey(), archivePoolMessage("pool-2", now), signature),
    false
  )
})

test("archive: a proof to archive cannot be replayed to unarchive", () => {
  // The two messages differ by more than the pool id for exactly this reason.
  const admin = Keypair.random()
  const now = Date.now()
  const signature = sign(admin, archivePoolMessage("pool-1", now))

  assert.strictEqual(
    verifySignedMessage(admin.publicKey(), unarchivePoolMessage("pool-1", now), signature),
    false
  )
})

test("archive: a captured proof stops working once it goes stale", () => {
  const admin = Keypair.random()
  const signedAt = Date.now() - PROOF_MAX_AGE_MS - 1_000
  const message = archivePoolMessage("pool-1", signedAt)

  assert.strictEqual(proofIsFresh(signedAt), false)
  assert.strictEqual(
    checkWalletProof({
      address: admin.publicKey(),
      message,
      signature: sign(admin, message),
      signedAt,
    }).ok,
    false
  )
})
