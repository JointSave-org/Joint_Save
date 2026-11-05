/**
 * Every example imports from the package root only.
 *
 * Deep imports (`@jointsave/sdk/dist/...`) are unsupported and may break
 * without a major version bump.
 */
import {
  NETWORKS,
  SDK_VERSION,
  buildSnapshot,
  computeActionEligibility,
  formatTokenAmount,
  getNetworkConfig,
  isGateAllowed,
  isValidContractId,
  scAddress,
  toBaseUnits,
  type NetworkName,
} from "@jointsave/sdk";

const network: NetworkName = "testnet";
const config = getNetworkConfig(network);
const sameConfig = NETWORKS[network];
const viewer = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

const snapshot = buildSnapshot({
  poolType: "rotational",
  status: "active",
  members: [viewer],
  viewer,
  depositAmount: toBaseUnits("10"),
  minimumDeposit: toBaseUnits("1"),
  balances: { [viewer]: toBaseUnits("10") },
  round: { deadlineSecs: 1_800_000_000, completed: false, paidOut: false },
  nowSecs: 1_799_000_000,
});
const gates = computeActionEligibility(snapshot);

console.log({
  version: SDK_VERSION,
  network: config.name,
  rpc: sameConfig.rpcUrl,
  nativeSac: config.nativeSacId,
  validContract: isValidContractId(config.nativeSacId),
  encodedAddressType: scAddress(viewer).switch().name,
  amount: formatTokenAmount(toBaseUnits("12.5")),
  canDeposit: isGateAllowed(gates, "deposit"),
});
