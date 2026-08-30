/**
 * Proof that an archive or unarchive really came from the pool's admin.
 *
 * Archiving takes a pool out of Explore and out of everyone's active list, and
 * unarchiving puts it back. Neither moves funds, but both change what every
 * member sees, and the endpoints cannot take an address in a request body as
 * evidence of anything: a pool id and its creator's address are public, so a
 * caller could otherwise archive a circle they have nothing to do with.
 *
 * The wallet signs a short, timestamped message naming the exact pool, and the
 * server rebuilds it and checks the signature against the pool's admin as
 * recorded. The two messages differ, so a proof gathered to archive cannot be
 * turned around and replayed to unarchive.
 *
 * Runs in the browser: it needs the wallet.
 */

import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit"
import { archivePoolMessage, unarchivePoolMessage } from "@/lib/wallet-proof"

export interface ArchiveProof {
  signature: string
  signedAt: number
}

interface SignParams {
  kit: StellarWalletsKit
  networkPassphrase: string
  adminAddress: string
  poolId: string
}

async function sign(
  params: SignParams,
  build: (poolId: string, signedAt: number) => string
): Promise<ArchiveProof> {
  const signedAt = Date.now()
  const { signedMessage } = await params.kit.signMessage(build(params.poolId, signedAt), {
    address: params.adminAddress,
    networkPassphrase: params.networkPassphrase,
  })
  return { signature: signedMessage, signedAt }
}

/** Signs the proof needed to archive a pool. */
export function signArchiveProof(params: SignParams): Promise<ArchiveProof> {
  return sign(params, archivePoolMessage)
}

/** Signs the proof needed to bring an archived pool back. */
export function signUnarchiveProof(params: SignParams): Promise<ArchiveProof> {
  return sign(params, unarchivePoolMessage)
}
