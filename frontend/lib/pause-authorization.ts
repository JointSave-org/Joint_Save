/**
 * Lets a pool admin pre-authorise the automatic pause.
 *
 * The security circuit breaker can halt a pool at the platform level on its own,
 * but the contract's `pause` asserts `admin.require_auth()`, and the admin is the
 * creator's own wallet. Rather than ask anyone to hand over a key, this signs a
 * single `SorobanAuthorizationEntry` that authorises exactly one call,
 * `pause(admin)` on exactly one contract, and nothing else.
 *
 * The entry is signed independently of any transaction envelope, so the platform
 * can wrap it in a transaction later, pay the fee itself, and submit it the
 * moment the breaker trips. What the admin gives up is precisely the ability to
 * pause their own pool, and only until the signature expires.
 *
 * Runs in the browser: it needs the wallet.
 */

import {
  Address,
  authorizeInvocation,
  rpc,
  xdr,
  type xdr as XdrNamespace,
} from "@stellar/stellar-sdk"
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit"

/**
 * How long a signature stays good for, in ledgers. About 30 days at six seconds
 * a ledger. Long enough that re-signing is a rare chore, short enough that a
 * forgotten authorization lapses on its own.
 */
export const DEFAULT_VALIDITY_LEDGERS = 432_000

export interface SignedPauseAuthorization {
  /** Base64 XDR, ready to POST to /api/admin/pause-authorizations. */
  entryXdr: string
  expirationLedger: number
}

/**
 * Builds the `pause(admin)` invocation and has the wallet sign it.
 *
 * The invocation is constructed here rather than taken from a simulation, so no
 * transaction has to be built, funded or simulated just to produce a signature.
 * `authorizeInvocation` attaches the nonce and expiration the host requires.
 */
export async function signPauseAuthorization(params: {
  kit: StellarWalletsKit
  rpcUrl: string
  networkPassphrase: string
  contractAddress: string
  adminAddress: string
  validityLedgers?: number
}): Promise<SignedPauseAuthorization> {
  const server = new rpc.Server(params.rpcUrl, {
    allowHttp: params.rpcUrl.startsWith("http://"),
  })

  const latest = await server.getLatestLedger()
  const expirationLedger = latest.sequence + (params.validityLedgers ?? DEFAULT_VALIDITY_LEDGERS)

  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(params.contractAddress).toScAddress(),
        functionName: "pause",
        args: [Address.fromString(params.adminAddress).toScVal()],
      })
    ),
    // No sub-invocations: this authorises the pause and cannot carry anything
    // else along with it. The server checks the same thing before storing it.
    subInvocations: [],
  })

  const entry = await authorizeInvocation(
    async (preimage: XdrNamespace.HashIdPreimage) => {
      // SEP-43: the wallet is handed the preimage to sign and returns the
      // signature, which is what `authorizeInvocation` splices into the entry.
      const { signedAuthEntry } = await params.kit.signAuthEntry(preimage.toXDR("base64"), {
        address: params.adminAddress,
        networkPassphrase: params.networkPassphrase,
      })
      return Buffer.from(signedAuthEntry, "base64")
    },
    expirationLedger,
    invocation,
    params.adminAddress,
    params.networkPassphrase
  )

  return { entryXdr: entry.toXDR("base64"), expirationLedger }
}
