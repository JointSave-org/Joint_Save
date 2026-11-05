import { describe, expect, it } from "vitest";
import type { YieldAllocationState } from "../types";
import {
  buildSnapshot,
  computeActionEligibility,
  describeGateReason,
  isGateAllowed,
  isGateBlocked,
} from "./engine";
import {
  GATE_REASONS,
  type GateAction,
  type StateSnapshot,
  type StateSnapshotInput,
} from "./types";

const VIEWER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const OTHER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const STRANGER = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const VAULT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const ALL_ACTIONS: GateAction[] = [
  "deposit",
  "withdraw",
  "contribute",
  "triggerPayout",
  "claim",
  "createProposal",
  "vote",
  "execute",
  "allocateYield",
  "deallocateYield",
  "syncYield",
];

function yieldState(overrides: Partial<YieldAllocationState> = {}): YieldAllocationState {
  return {
    vault: VAULT,
    shares: 100n,
    costBasis: 100n,
    bufferBps: 2_000,
    locked: false,
    position: 110n,
    unrealised: 10n,
    maxAllocatable: 50n,
    ...overrides,
  };
}

function snap(overrides: StateSnapshotInput = {}): StateSnapshot {
  return buildSnapshot({
    poolType: "rotational",
    status: "active",
    contractDeployed: true,
    members: [VIEWER, OTHER],
    viewer: VIEWER,
    balances: { [VIEWER]: 100n, [OTHER]: 100n },
    depositAmount: 100n,
    minimumDeposit: 10n,
    round: { index: 1, deadlineSecs: 1_000, completed: false, paidOut: false, funded: true },
    nowSecs: 2_000,
    ...overrides,
  });
}

function reason(snapshot: StateSnapshot, action: GateAction) {
  const result = computeActionEligibility(snapshot);
  expect(result[action].allowed).toBe(false);
  return result[action].reason;
}

describe("computeActionEligibility shape", () => {
  it("returns an entry for every action", () => {
    const result = computeActionEligibility(snap());
    expect(Object.keys(result).sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it("never leaves a blocked action without a reason", () => {
    const snapshots = [
      snap({ viewer: STRANGER }),
      snap({ status: "paused" }),
      snap({ status: "archived" }),
      snap({ contractDeployed: false }),
      snap({ poolType: "flexible" }),
    ];
    for (const snapshot of snapshots) {
      for (const action of ALL_ACTIONS) {
        const decision = computeActionEligibility(snapshot)[action];
        if (!decision.allowed) expect(decision.reason).not.toBeNull();
      }
    }
  });

  it("is deterministic for the same snapshot", () => {
    const snapshot = snap();
    expect(computeActionEligibility(snapshot)).toEqual(computeActionEligibility(snapshot));
  });
});

describe("deposit and contribute", () => {
  it("allows a member to deposit in an active rotational round", () => {
    const result = computeActionEligibility(snap());
    expect(isGateAllowed(result, "deposit")).toBe(true);
    expect(isGateAllowed(result, "contribute")).toBe(true);
  });

  it("blocks non-members", () => {
    expect(reason(snap({ viewer: STRANGER }), "deposit")).toBe("not_member");
  });

  it("blocks when the contract is not deployed", () => {
    expect(reason(snap({ contractDeployed: false }), "deposit")).toBe("contract_not_deployed");
  });

  it("blocks inactive, paused, and archived pools", () => {
    expect(reason(snap({ status: "pending_deployment" }), "deposit")).toBe("pool_not_active");
    expect(reason(snap({ status: "paused" }), "deposit")).toBe("pool_paused");
    expect(reason(snap({ status: "archived" }), "deposit")).toBe("pool_archived");
  });

  it("blocks completed and already-deposited rotational rounds", () => {
    expect(reason(snap({ round: { completed: true } }), "deposit")).toBe("round_complete");
    expect(reason(snap({ hasDeposited: true }), "deposit")).toBe("already_deposited");
  });

  it("enforces the minimum for flexible pools", () => {
    const flexible = (amount: bigint) =>
      snap({ poolType: "flexible", requestedAmount: amount, nowSecs: 500 });
    expect(computeActionEligibility(flexible(10n)).deposit.allowed).toBe(true);
    expect(reason(flexible(9n), "deposit")).toBe("below_minimum");
  });

  it("blocks target deposits after the deadline", () => {
    expect(reason(snap({ poolType: "target", nowSecs: 2_000 }), "deposit")).toBe("deadline_passed");
    expect(
      computeActionEligibility(snap({ poolType: "target", nowSecs: 500 })).deposit.allowed
    ).toBe(true);
  });
});

describe("withdraw and claim", () => {
  it("allows a member to withdraw from a flexible pool", () => {
    const snapshot = snap({ poolType: "flexible" });
    const result = computeActionEligibility(snapshot);
    expect(result.withdraw.allowed).toBe(true);
    expect(result.claim.allowed).toBe(true);
  });

  it("blocks non-members", () => {
    expect(reason(snap({ poolType: "flexible", viewer: STRANGER }), "withdraw")).toBe("not_member");
  });

  it("marks rotational withdrawals unsupported", () => {
    expect(reason(snap(), "withdraw")).toBe("unsupported_action");
    expect(reason(snap(), "claim")).toBe("unsupported_action");
  });

  it("locks target withdrawals until the pool completes", () => {
    expect(reason(snap({ poolType: "target", status: "active" }), "withdraw")).toBe("target_locked");
    expect(
      computeActionEligibility(snap({ poolType: "target", status: "completed" })).withdraw.allowed
    ).toBe(true);
  });

  it("blocks paused and archived withdrawals", () => {
    expect(reason(snap({ poolType: "flexible", paused: true }), "withdraw")).toBe("pool_paused");
    expect(reason(snap({ poolType: "flexible", archived: true }), "withdraw")).toBe("pool_archived");
    expect(reason(snap({ poolType: "flexible", status: "pending_deployment" }), "withdraw")).toBe(
      "pool_not_active"
    );
  });

  it("blocks insufficient and illiquid balances", () => {
    expect(reason(snap({ poolType: "flexible", requestedAmount: 101n }), "withdraw")).toBe(
      "insufficient_balance"
    );
    expect(reason(snap({ poolType: "flexible", liquidBalance: 50n }), "withdraw")).toBe(
      "vault_illiquid"
    );
    expect(
      computeActionEligibility(
        snap({ poolType: "flexible", liquidBalance: 50n, requestedAmount: 40n })
      ).withdraw.allowed
    ).toBe(true);
  });
});

describe("triggerPayout", () => {
  it("allows a funded, unpaid round after its deadline", () => {
    expect(computeActionEligibility(snap()).triggerPayout.allowed).toBe(true);
  });

  it("blocks before the deadline", () => {
    expect(reason(snap({ nowSecs: 500 }), "triggerPayout")).toBe("too_early");
  });

  it("blocks paid or completed rounds", () => {
    expect(reason(snap({ round: { paidOut: true } }), "triggerPayout")).toBe("already_paid");
    expect(reason(snap({ round: { completed: true } }), "triggerPayout")).toBe("already_paid");
  });

  it("blocks unfunded rounds", () => {
    expect(
      reason(
        snap({
          round: { funded: false },
        }),
        "triggerPayout"
      )
    ).toBe("not_funded");
    expect(
      reason(
        snap({
          round: { funded: undefined },
          balances: { [VIEWER]: 100n, [OTHER]: 50n },
        }),
        "triggerPayout"
      )
    ).toBe("not_funded");
  });

  it("derives funding from balances when not supplied", () => {
    expect(
      computeActionEligibility(
        snap({ round: { funded: undefined }, balances: { [VIEWER]: 100n, [OTHER]: 100n } })
      ).triggerPayout.allowed
    ).toBe(true);
  });

  it("rejects non-rotational pools", () => {
    expect(reason(snap({ poolType: "flexible" }), "triggerPayout")).toBe("unsupported_action");
  });
});

describe("governance", () => {
  const activeProposal = {
    status: "Active" as const,
    quorum: 51,
    viewerVoted: false,
    viewerIsAdmin: true,
  };

  it("allows an admin to create a proposal", () => {
    expect(computeActionEligibility(snap({ viewerIsAdmin: true })).createProposal.allowed).toBe(true);
    expect(
      computeActionEligibility(snap({ governance: { viewerCanPropose: true } })).createProposal
        .allowed
    ).toBe(true);
  });

  it("blocks non-admin proposal creation", () => {
    expect(reason(snap(), "createProposal")).toBe("not_admin");
    expect(reason(snap({ archived: true, viewerIsAdmin: true }), "createProposal")).toBe(
      "pool_archived"
    );
  });

  it("allows a member to vote on an active proposal", () => {
    expect(
      computeActionEligibility(snap({ governance: activeProposal })).vote.allowed
    ).toBe(true);
  });

  it("blocks non-members, inactive proposals, repeat votes, and expired proposals", () => {
    expect(reason(snap({ governance: activeProposal, viewer: STRANGER }), "vote")).toBe(
      "not_member"
    );
    expect(reason(snap(), "vote")).toBe("proposal_not_active");
    expect(
      reason(snap({ governance: { ...activeProposal, status: "Passed" } }), "vote")
    ).toBe("proposal_not_active");
    expect(
      reason(snap({ governance: { ...activeProposal, viewerVoted: true } }), "vote")
    ).toBe("already_voted");
    expect(
      reason(snap({ governance: { ...activeProposal, expiresAtSecs: 1_000 } }), "vote")
    ).toBe("proposal_expired");
  });

  it("allows execution of a passed proposal with quorum", () => {
    expect(
      computeActionEligibility(
        snap({
          governance: {
            status: "Passed",
            quorum: 51,
            votesFor: [VIEWER, OTHER],
            viewerIsAdmin: true,
          },
        })
      ).execute.allowed
    ).toBe(true);
  });

  it("blocks execution without quorum, without role, or before passing", () => {
    expect(
      reason(
        snap({
          governance: {
            status: "Passed",
            quorum: 100,
            votesFor: [VIEWER],
            viewerIsAdmin: true,
          },
        }),
        "execute"
      )
    ).toBe("quorum_not_met");
    expect(
      reason(snap({ governance: { status: "Passed", quorum: 51, votesFor: [VIEWER, OTHER] } }), "execute")
    ).toBe("not_admin");
    expect(
      reason(
        snap({
          governance: {
            status: "Active",
            quorum: 51,
            votesFor: [VIEWER, OTHER],
            viewerIsAdmin: true,
          },
        }),
        "execute"
      )
    ).toBe("proposal_not_active");
  });
});

describe("yield allocation", () => {
  it("allows an admin to allocate within the buffer", () => {
    expect(
      computeActionEligibility(
        snap({
          poolType: "flexible",
          viewerIsAdmin: true,
          yield: yieldState(),
          requestedAmount: 40n,
        })
      ).allocateYield.allowed
    ).toBe(true);
  });

  it("blocks allocation without admin, with a lock, or without buffer headroom", () => {
    expect(reason(snap({ poolType: "flexible", yield: yieldState() }), "allocateYield")).toBe(
      "not_admin"
    );
    expect(
      reason(snap({ poolType: "flexible", viewerIsAdmin: true, yield: yieldState({ locked: true }) }), "allocateYield")
    ).toBe("vault_locked");
    expect(
      reason(
        snap({ poolType: "flexible", viewerIsAdmin: true, yield: yieldState({ maxAllocatable: 0n }) }),
        "allocateYield"
      )
    ).toBe("buffer_exhausted");
    expect(
      reason(
        snap({
          poolType: "flexible",
          viewerIsAdmin: true,
          yield: yieldState(),
          requestedAmount: 51n,
        }),
        "allocateYield"
      )
    ).toBe("buffer_exhausted");
    expect(reason(snap({ poolType: "flexible", viewerIsAdmin: true }), "allocateYield")).toBe(
      "yield_disabled"
    );
  });

  it("allows members to de-allocate when a position exists, even when locked", () => {
    expect(
      computeActionEligibility(snap({ poolType: "flexible", yield: yieldState() })).deallocateYield
        .allowed
    ).toBe(true);
    expect(
      computeActionEligibility(
        snap({ poolType: "flexible", yield: yieldState({ locked: true }) })
      ).deallocateYield.allowed
    ).toBe(true);
  });

  it("blocks de-allocation for non-members and empty positions", () => {
    expect(
      reason(snap({ poolType: "flexible", viewer: STRANGER, yield: yieldState() }), "deallocateYield")
    ).toBe("not_member");
    expect(
      reason(snap({ poolType: "flexible", yield: yieldState({ position: 0n }) }), "deallocateYield")
    ).toBe("not_allocated");
  });

  it("allows members to sync yield and blocks empty positions", () => {
    expect(
      computeActionEligibility(snap({ poolType: "flexible", yield: yieldState() })).syncYield.allowed
    ).toBe(true);
    expect(
      reason(snap({ poolType: "flexible", yield: yieldState({ position: 0n }) }), "syncYield")
    ).toBe("not_allocated");
    expect(
      reason(snap({ poolType: "flexible", viewer: STRANGER, yield: yieldState() }), "syncYield")
    ).toBe("not_member");
  });
});

describe("buildSnapshot", () => {
  it("fills defaults for empty input", () => {
    const snapshot = buildSnapshot({}, 123);
    expect(snapshot.poolType).toBe("rotational");
    expect(snapshot.status).toBe("active");
    expect(snapshot.contractDeployed).toBe(true);
    expect(snapshot.members).toEqual([]);
    expect(snapshot.balances).toEqual({});
    expect(snapshot.depositAmount).toBe(0n);
    expect(snapshot.minimumDeposit).toBe(0n);
    expect(snapshot.nowSecs).toBe(123);
    expect(snapshot.round).toEqual({
      index: 0,
      deadlineSecs: 0,
      completed: false,
      paidOut: false,
    });
    expect(() => computeActionEligibility(snapshot)).not.toThrow();
  });

  it("coerces loose numeric input and preserves explicit flags", () => {
    const snapshot = buildSnapshot({
      balances: { [VIEWER]: 5 as unknown as bigint },
      depositAmount: 10 as unknown as bigint,
      requestedAmount: 3 as unknown as bigint,
      hasDeposited: true,
      paused: true,
    });
    expect(snapshot.balances[VIEWER]).toBe(5n);
    expect(snapshot.depositAmount).toBe(10n);
    expect(snapshot.requestedAmount).toBe(3n);
    expect(snapshot.hasDeposited).toBe(true);
    expect(snapshot.paused).toBe(true);
  });

  it("uses the supplied nowSecs over the input value", () => {
    expect(buildSnapshot({ nowSecs: 1 }, 2).nowSecs).toBe(2);
  });
});

describe("describeGateReason", () => {
  it("has user-facing copy for every reason", () => {
    for (const reasonCode of GATE_REASONS) {
      expect(describeGateReason(reasonCode).length).toBeGreaterThan(0);
    }
  });

  it("returns an empty string for null", () => {
    expect(describeGateReason(null)).toBe("");
    expect(describeGateReason(undefined)).toBe("");
  });

  it("interpolates context when provided", () => {
    expect(describeGateReason("below_minimum", { minimumDeposit: 10n })).toContain("10");
    expect(describeGateReason("unsupported_action", { poolType: "rotational" })).toContain(
      "rotational"
    );
  });
});

describe("helpers", () => {
  it("reports allowed and blocked consistently", () => {
    const result = computeActionEligibility(snap());
    expect(isGateAllowed(result, "deposit")).toBe(true);
    expect(isGateBlocked(result, "deposit")).toBe(false);
    expect(isGateAllowed(result, "withdraw")).toBe(false);
    expect(isGateBlocked(result, "withdraw")).toBe(true);
  });
});
