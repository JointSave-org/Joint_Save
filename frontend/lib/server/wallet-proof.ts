/**
 * Checking that a request really comes from the wallet it claims.
 *
 * Most admin endpoints in this codebase compare a `callerAddress` from the
 * request against the pool's `creator_address`. That is a claim, not a proof:
 * both values are public, so anyone can send either.
 *
 * For most of those endpoints that is a pre-existing trade-off. It is not
 * acceptable for revoking a pause authorization, because revoking one disarms
 * the automatic on-chain pause: an attacker preparing to drain a pool could
 * switch off the very thing meant to stop them, using only public data. So that
 * one action asks for a signature instead.
 *
 * SEP-53 is used because it is what wallets implement (`signMessage` across the
 * wallet-kit modules) and what `require_auth` already relies on for classic
 * accounts: an ed25519 signature over the SHA-256 of a prefixed message.
 *
 * Server-side only.
 */

import { createHash } from "node:crypto"
import { Keypair, StrKey } from "@stellar/stellar-sdk"
import { proofIsFresh } from "@/lib/wallet-proof"

/** SEP-53 framing. Signers prepend exactly this before hashing. */
const SEP53_PREFIX = "Stellar Signed Message:\n"

export interface ProofCheck {
  ok: boolean
  reason?: string
}

/**
 * Verifies a SEP-53 signature over `message` for `address`.
 *
 * Both framings are accepted: the SHA-256 of the prefixed message, which is what
 * SEP-53 specifies, and the prefixed bytes handed straight to ed25519, which
 * some signers produce instead. Either way the signature can only come from the
 * account's private key, so accepting both costs nothing in strength and saves
 * the endpoint from breaking on a wallet that frames it the other way.
 */
export function verifySignedMessage(
  address: string,
  message: string,
  signatureBase64: string
): boolean {
  if (!StrKey.isValidEd25519PublicKey(address)) return false

  let signature: Buffer
  try {
    signature = Buffer.from(signatureBase64, "base64")
  } catch {
    return false
  }
  if (signature.length !== 64) return false

  const payload = Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), Buffer.from(message, "utf8")])
  const digest = createHash("sha256").update(payload).digest()

  try {
    const keypair = Keypair.fromPublicKey(address)
    return keypair.verify(digest, signature) || keypair.verify(payload, signature)
  } catch {
    return false
  }
}

/**
 * The whole check an endpoint needs: the proof is fresh, and it was signed by
 * the address the action belongs to.
 *
 * Returns a reason rather than a bare boolean so the caller can tell an admin
 * whose clock drifted from one whose wallet signed with the wrong account.
 */
export function checkWalletProof(params: {
  address: string
  message: string
  signature: unknown
  signedAt: unknown
}): ProofCheck {
  const signature = typeof params.signature === "string" ? params.signature : ""
  const signedAt = Number(params.signedAt)

  if (!signature) {
    return { ok: false, reason: "A wallet signature is required for this action." }
  }
  if (!proofIsFresh(signedAt)) {
    return {
      ok: false,
      reason: "That signature is too old or its timestamp is off. Sign again.",
    }
  }
  if (!verifySignedMessage(params.address, params.message, signature)) {
    return { ok: false, reason: "The signature does not match this pool's admin." }
  }
  return { ok: true }
}
