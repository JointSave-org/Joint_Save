/**
 * Submits the on-chain half of an automatic pause.
 *
 * `rotational::pause` asserts `admin.require_auth()` and that the caller is the
 * pool's stored admin, which is the creator's own wallet. The platform holds no
 * key that satisfies that, and `SPONSOR_SECRET_KEY` cannot stand in: a fee bump
 * pays for a transaction, it authorises nothing inside it.
 *
 * What makes this possible anyway is that a `SorobanAuthorizationEntry` is
 * signed independently of the transaction envelope. The admin signs one entry,
 * from their own wallet, covering exactly `pause(admin)` on exactly their pool's
 * contract. The platform stores it and, when the breaker trips, wraps it in a
 * transaction it pays for and signs the envelope of. The two signatures are
 * separate: the admin authorises the call, the platform authorises the fee.
 *
 * So the platform can pause, and can do nothing else. It never sees the admin's
 * key, and the entry it holds commits to one invocation with one nonce.
 *
 * Server-side only.
 */

import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk"
import { getServerRpc } from "@/lib/server/stellar-events"

/**
 * The network the contracts live on. Matches `components/web3-provider.tsx`,
 * which is a client component and cannot be imported here.
 */
export const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET

/** How long to wait for the ledger to include the transaction. */
const CONFIRM_TIMEOUT_MS = 30_000
const CONFIRM_POLL_MS = 2_000

export type PauseSubmission =
  | { status: "submitted"; hash: string }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string; hash?: string }

/**
 * Wraps a pre-signed authorization in a transaction and submits it.
 *
 * Returns a result rather than throwing: the platform pause has already
 * happened by the time this runs, and a failure here must downgrade the
 * incident to "an admin needs to sign it", never lose the pause.
 */
export async function submitOnChainPause(params: {
  contractAddress: string
  adminAddress: string
  /** Base64 XDR of the admin-signed SorobanAuthorizationEntry. */
  entryXdr: string
}): Promise<PauseSubmission> {
  const secret = process.env.SPONSOR_SECRET_KEY
  if (!secret) {
    return { status: "unavailable", reason: "SPONSOR_SECRET_KEY is not configured" }
  }

  let sponsor: Keypair
  let entry: xdr.SorobanAuthorizationEntry
  try {
    sponsor = Keypair.fromSecret(secret)
    entry = xdr.SorobanAuthorizationEntry.fromXDR(params.entryXdr, "base64")
  } catch (error) {
    return {
      status: "failed",
      reason: `Could not load the sponsor key or the stored authorization: ${message(error)}`,
    }
  }

  try {
    const server = getServerRpc()
    const account = await server.getAccount(sponsor.publicKey())

    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: params.contractAddress,
          function: "pause",
          args: [Address.fromString(params.adminAddress).toScVal()],
          // The admin's signature travels here, not on the envelope.
          auth: [entry],
        })
      )
      .setTimeout(60)
      .build()

    const simulation = await server.simulateTransaction(built)
    if (rpc.Api.isSimulationError(simulation)) {
      // The usual causes are an expired entry, a spent nonce, or an admin that
      // no longer matches the contract's stored one.
      return { status: "failed", reason: `Simulation failed: ${simulation.error}` }
    }

    // `assembleTransaction` keeps auth entries the operation already carries and
    // only falls back to the simulation's when there are none, so the admin's
    // signature survives being given a footprint and a resource fee.
    const prepared = rpc.assembleTransaction(built, simulation).build()
    prepared.sign(sponsor)

    const sent = await server.sendTransaction(prepared)
    if (sent.status === "ERROR") {
      return {
        status: "failed",
        reason: `The network rejected the transaction: ${JSON.stringify(sent.errorResult ?? sent.status)}`,
        hash: sent.hash,
      }
    }

    const confirmed = await waitForTransaction(server, sent.hash)
    if (confirmed !== "SUCCESS") {
      return {
        status: "failed",
        reason: `The transaction did not confirm: ${confirmed}`,
        hash: sent.hash,
      }
    }

    return { status: "submitted", hash: sent.hash }
  } catch (error) {
    return { status: "failed", reason: message(error) }
  }
}

/**
 * Polls until the ledger has an answer.
 *
 * A pending result at the end of the window is reported as such rather than as
 * a failure: the transaction may still land, and the incident says an admin
 * should check rather than claiming it did not happen.
 */
async function waitForTransaction(
  server: rpc.Server,
  hash: string
): Promise<"SUCCESS" | "FAILED" | "NOT_FOUND" | "PENDING"> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS

  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash)
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return "SUCCESS"
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) return "FAILED"
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS))
  }

  return "PENDING"
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The ledger the RPC is currently on, used to judge whether an entry is stale. */
export async function currentLedger(): Promise<number | null> {
  try {
    const server = getServerRpc()
    const latest = await server.getLatestLedger()
    return latest.sequence
  } catch {
    return null
  }
}

// ── Inspecting what an admin actually signed ─────────────────────────────────

export interface AuthorizationInspection {
  ok: boolean
  reason?: string
  adminAddress?: string
  contractAddress?: string
  expirationLedger?: number
}

/**
 * Reads a submitted authorization and checks it authorises a pause and nothing
 * else.
 *
 * The client says what it signed; this decides whether to believe it. An entry
 * is a bearer credential the platform will submit later, so it is checked here
 * rather than trusted: it has to be address-credentialed (a source-account
 * credential would authorise whoever submits, which is not a delegation), it has
 * to invoke `pause` with the signer as its only argument, and it must carry no
 * sub-invocations, so it cannot smuggle a second call along with the pause.
 */
export function inspectPauseAuthorization(entryXdr: string): AuthorizationInspection {
  let entry: xdr.SorobanAuthorizationEntry
  try {
    entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64")
  } catch {
    return { ok: false, reason: "That is not a valid authorization entry." }
  }

  try {
    const credentials = entry.credentials()
    if (credentials.switch().name !== "sorobanCredentialsAddress") {
      return {
        ok: false,
        reason: "The entry is not signed by an address, so it delegates nothing.",
      }
    }

    const address = credentials.address()
    const signer = Address.fromScAddress(address.address()).toString()
    const expirationLedger = address.signatureExpirationLedger()

    const invocation = entry.rootInvocation()
    if (invocation.subInvocations().length > 0) {
      return { ok: false, reason: "The entry authorises more than the pause call." }
    }

    const fn = invocation.function()
    if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
      return { ok: false, reason: "The entry does not authorise a contract call." }
    }

    const call = fn.contractFn()
    const functionName = call.functionName().toString()
    if (functionName !== "pause") {
      return { ok: false, reason: `The entry authorises "${functionName}", not "pause".` }
    }

    const args = call.args()
    if (args.length !== 1) {
      return { ok: false, reason: "The pause call must take exactly the admin address." }
    }

    const argAddress = Address.fromScVal(args[0]).toString()
    if (argAddress !== signer) {
      return {
        ok: false,
        reason: "The entry would pause on behalf of a different address than its signer.",
      }
    }

    return {
      ok: true,
      adminAddress: signer,
      contractAddress: Address.fromScAddress(call.contractAddress()).toString(),
      expirationLedger,
    }
  } catch (error) {
    return { ok: false, reason: `The entry could not be read: ${message(error)}` }
  }
}
