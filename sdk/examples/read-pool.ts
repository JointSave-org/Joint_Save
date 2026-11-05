import {
  JointSaveClient,
  formatTokenAmount,
  getNetworkConfig,
} from "@jointsave/sdk";

const FACTORY_ID = "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI";
// Replace with a pool contract id from your deployment.
const POOL_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const MEMBER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

async function main() {
  const client = new JointSaveClient({
    network: "testnet",
    contractIds: { factory: FACTORY_ID },
  });

  const { explorerUrl } = getNetworkConfig("testnet");

  const version = await client.factory.getVersion();
  const token = await client.factory.getToken();
  const state = await client.pool.getRotationalState(POOL_ID, MEMBER);

  console.log({
    explorer: `${explorerUrl}/contract/${FACTORY_ID}`,
    factoryVersion: version,
    token,
    active: state.isActive,
    round: state.currentRound,
    members: state.members.length,
    depositedThisRound: state.hasDeposited,
    nextPayout: new Date(state.nextPayoutTime * 1000).toISOString(),
  });

  const target = await client.pool.getTargetState(POOL_ID, MEMBER);
  console.log({
    totalDeposited: formatTokenAmount(target.totalDeposited),
    targetAmount: formatTokenAmount(target.targetAmount),
    yourBalance: formatTokenAmount(target.userBalance),
    unlocked: target.isUnlocked,
  });
}

void main();
