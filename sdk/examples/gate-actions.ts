import {
  buildSnapshot,
  computeActionEligibility,
  describeGateReason,
  isGateAllowed,
  toBaseUnits,
  type GateAction,
} from "@jointsave/sdk";

const viewer = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const nowSecs = Math.floor(Date.now() / 1000);

const snapshot = buildSnapshot({
  poolType: "rotational",
  status: "active",
  members: [viewer, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
  viewer,
  round: {
    index: 0,
    deadlineSecs: nowSecs + 86_400,
    completed: false,
    paidOut: false,
    funded: true,
  },
  balances: { [viewer]: toBaseUnits("10") },
  depositAmount: toBaseUnits("10"),
  minimumDeposit: toBaseUnits("1"),
  nowSecs,
  hasDeposited: false,
});

const gates = computeActionEligibility(snapshot);

for (const action of Object.keys(gates) as GateAction[]) {
  const decision = gates[action];
  console.log(
    action,
    isGateAllowed(gates, action) ? "allowed" : "blocked",
    describeGateReason(decision.reason, { poolType: snapshot.poolType })
  );
}
