import {
  JointSaveClient,
  toBaseUnits,
  type SignTransaction,
} from "@jointsave/sdk";

const FACTORY_ID = "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI";
// Replace with a pool contract id from your deployment.
const POOL_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const MEMBER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

/**
 * Replace this with a wallet adapter (Freighter, xBull, Albedo, ...).
 *
 * The signer receives an already-prepared transaction envelope and must return
 * the signed envelope. It never receives a secret key.
 */
const stubSigner: SignTransaction = async (unsignedXdr) => {
  // A real wallet signs here. This stub keeps the example secret-free.
  return unsignedXdr;
};

async function main() {
  const client = new JointSaveClient({
    network: "testnet",
    contractIds: { factory: FACTORY_ID },
  });

  const options = { accountId: MEMBER, signer: stubSigner };

  const rotational = await client.pool.deposit(
    "rotational",
    POOL_ID,
    { member: MEMBER },
    options
  );

  console.log({ hash: rotational.hash, status: rotational.status });

  const flexible = await client.pool.deposit(
    "flexible",
    POOL_ID,
    { member: MEMBER, amount: toBaseUnits("25") },
    options
  );

  console.log({ hash: flexible.hash, status: flexible.status });
}

void main();
