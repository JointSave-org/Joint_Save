import {
  JointSaveClient,
  mayHaveReachedServer,
  withRpcRetry,
  type SignTransaction,
} from "@jointsave/sdk";

const FACTORY_ID = "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI";
// Replace with a pool contract id from your deployment.
const POOL_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const MEMBER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

const signer: SignTransaction = async (unsignedXdr) => unsignedXdr;

async function main() {
  const client = new JointSaveClient({
    network: "testnet",
    contractIds: { factory: FACTORY_ID },
  });

  const registry = await withRpcRetry(() => client.factory.getPools(), { retries: 3 });
  console.log("registered pools", {
    rotational: registry.rotational.length,
    target: registry.target.length,
    flexible: registry.flexible.length,
  });

  try {
    const result = await client.pool.deposit(
      "rotational",
      POOL_ID,
      { member: MEMBER },
      { accountId: MEMBER, signer }
    );

    if (result.status === "timeout") {
      // The send may have landed. Never resubmit blindly.
      const lookup = await client.lookupTransaction(result.hash, { timeoutMs: 30_000 });
      console.log({ recovery: lookup.state, ledger: lookup.ledger });

      if (lookup.state === "pending") {
        console.log("Still pending; wait and look up the same hash again.");
      } else if (lookup.state === "failed") {
        console.log("Failed on-chain", lookup.resultCode, lookup.contractError?.message);
      }
    }
  } catch (error) {
    if (mayHaveReachedServer(error)) {
      console.error("Ambiguous failure: keep the hash and look it up before retrying.");
    } else {
      console.error("Deterministic failure: fix the request before retrying.", error);
    }
  }
}

void main();
