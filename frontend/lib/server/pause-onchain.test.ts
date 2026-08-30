// Unit tests for the pause authorization inspector.
//
// A stored authorization is a bearer credential the platform will submit on the
// admin's behalf, so what matters most is what it REFUSES to store. These build
// real entries with the real XDR library and sign them with a throwaway key, so
// the checks run against the same bytes a wallet would produce. No network.
import { test } from "node:test"
import assert from "node:assert"
import { Address, authorizeInvocation, Keypair, Networks, xdr } from "@stellar/stellar-sdk"
import { inspectPauseAuthorization } from "./pause-onchain"

const PASSPHRASE = Networks.TESTNET
const EXPIRATION = 123_456

/** A strkey contract address standing in for a deployed pool. */
const CONTRACT = Address.contract(Buffer.alloc(32, 7)).toString()

function invocation(
  target: string,
  {
    fnName = "pause",
    withSubInvocation = false,
    args,
  }: {
    fnName?: string
    withSubInvocation?: boolean
    args?: xdr.ScVal[]
  } = {}
) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(CONTRACT).toScAddress(),
        functionName: fnName,
        args: args ?? [Address.fromString(target).toScVal()],
      })
    ),
    subInvocations: withSubInvocation
      ? [
          new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
              new xdr.InvokeContractArgs({
                contractAddress: Address.fromString(CONTRACT).toScAddress(),
                functionName: "emergency_withdraw",
                args: [],
              })
            ),
            subInvocations: [],
          }),
        ]
      : [],
  })
}

async function sign(signer: Keypair, inv: xdr.SorobanAuthorizedInvocation): Promise<string> {
  const entry = await authorizeInvocation(signer, EXPIRATION, inv, signer.publicKey(), PASSPHRASE)
  return entry.toXDR("base64")
}

test("inspector: accepts a properly signed pause authorization", async () => {
  const admin = Keypair.random()
  const result = inspectPauseAuthorization(await sign(admin, invocation(admin.publicKey())))

  assert.strictEqual(result.ok, true, result.reason)
  assert.strictEqual(result.adminAddress, admin.publicKey())
  assert.strictEqual(result.contractAddress, CONTRACT)
  assert.strictEqual(result.expirationLedger, EXPIRATION)
})

test("inspector: refuses something that is not an authorization entry", () => {
  assert.strictEqual(inspectPauseAuthorization("not-xdr").ok, false)
  assert.strictEqual(inspectPauseAuthorization("").ok, false)
})

test("inspector: refuses an entry authorising emergency_withdraw", async () => {
  // The hard boundary. An admin must never be able to hand the platform a
  // credential that moves member funds, by accident or otherwise.
  const admin = Keypair.random()
  const result = inspectPauseAuthorization(
    await sign(admin, invocation(admin.publicKey(), { fnName: "emergency_withdraw" }))
  )

  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /emergency_withdraw/)
})

test("inspector: refuses an entry smuggling a second call as a sub-invocation", async () => {
  const admin = Keypair.random()
  const result = inspectPauseAuthorization(
    await sign(admin, invocation(admin.publicKey(), { withSubInvocation: true }))
  )

  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /more than the pause call/)
})

test("inspector: refuses an entry that pauses on behalf of another address", async () => {
  const admin = Keypair.random()
  const someoneElse = Keypair.random()
  const result = inspectPauseAuthorization(await sign(admin, invocation(someoneElse.publicKey())))

  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /different address than its signer/)
})

test("inspector: refuses a pause call with the wrong number of arguments", async () => {
  const admin = Keypair.random()
  const result = inspectPauseAuthorization(
    await sign(admin, invocation(admin.publicKey(), { args: [] }))
  )

  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /exactly the admin address/)
})

test("inspector: refuses a source-account credential, which delegates nothing", async () => {
  // A source-account credential authorises whoever submits the transaction.
  // Storing one would be meaningless, and treating it as a delegation would be
  // worse than meaningless.
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation(Keypair.random().publicKey()),
  })
  const result = inspectPauseAuthorization(entry.toXDR("base64"))

  assert.strictEqual(result.ok, false)
  assert.match(result.reason ?? "", /not signed by an address/)
})
