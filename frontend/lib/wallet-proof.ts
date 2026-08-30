/**
 * The message a wallet signs to prove it controls an address.
 *
 * Shared by the browser, which asks the wallet to sign it, and the server, which
 * rebuilds it byte for byte and checks the signature. It lives in its own module
 * so neither side can drift from the other, and so the server never has to
 * import anything that touches a wallet.
 */

/**
 * How far a proof's timestamp may be from the server's clock.
 *
 * Short enough that a captured proof stops working quickly, wide enough to
 * survive an unsynchronised laptop clock and a slow signature.
 */
export const PROOF_MAX_AGE_MS = 5 * 60 * 1000

/**
 * The exact text signed to revoke a pause authorization.
 *
 * It names the action and the specific authorization, so a proof captured for
 * one revocation cannot be replayed against another, and carries a timestamp so
 * it stops being useful within minutes. Replaying it against the *same*
 * authorization achieves nothing: revoking an already revoked entry is a no-op.
 */
export function revokePauseAuthorizationMessage(authorizationId: string, signedAt: number): string {
  return [
    "JointSave: revoke pause authorization",
    `authorization: ${authorizationId}`,
    `at: ${signedAt}`,
    "Signing this does not move funds.",
  ].join("\n")
}

/**
 * The exact text signed to archive a pool, and to bring one back.
 *
 * Archiving is an admin action that changes what every member sees, so it is
 * proved the same way a pause authorization is. The two messages differ by more
 * than the pool id so a proof gathered to archive cannot be turned around and
 * replayed to unarchive, and each carries a timestamp so it expires in minutes.
 */
export function archivePoolMessage(poolId: string, signedAt: number): string {
  return [
    "JointSave: archive pool",
    `pool: ${poolId}`,
    `at: ${signedAt}`,
    "Signing this does not move funds.",
  ].join("\n")
}

export function unarchivePoolMessage(poolId: string, signedAt: number): string {
  return [
    "JointSave: unarchive pool",
    `pool: ${poolId}`,
    `at: ${signedAt}`,
    "Signing this does not move funds.",
  ].join("\n")
}

/** True while a proof's timestamp is close enough to now to be accepted. */
export function proofIsFresh(signedAt: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(signedAt)) return false
  return Math.abs(now - signedAt) <= PROOF_MAX_AGE_MS
}
