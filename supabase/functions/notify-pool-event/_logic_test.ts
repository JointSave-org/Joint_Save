import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildPlan,
  isHandledActivity,
  type NotificationPreferences,
  shortAddress,
  shouldSendEmail,
  type UserProfile,
  xlmFromStroops,
} from "./_logic.ts";

const MEMBERS = ["GBROJA-ALICE", "GBROJA-BOB", "GBROJA-CAROL"];

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    wallet_address: "GBROJA-ALICE",
    email: "alice@example.com",
    notification_preferences: {
      email_on_payout: true,
      email_on_deposit: true,
      email_on_round: true,
      email_on_target: true,
    },
    muted_pools: null,
    ...over,
  };
}

function prefs(
  over: Partial<NotificationPreferences> = {},
): NotificationPreferences {
  return {
    email_on_payout: true,
    email_on_deposit: true,
    email_on_round: true,
    email_on_target: true,
    ...over,
  };
}

Deno.test("shortAddress formats addr as head…tail", () => {
  const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  assertEquals(shortAddress(addr), "GABCDE…6789");
});

Deno.test("xlmFromStroops converts stroops to 2-decimal XLM", () => {
  assertEquals(xlmFromStroops(25_000_000), "2.50");
  assertEquals(xlmFromStroops(null), "?");
});

Deno.test("isHandledActivity only accepts the four email-worthy types", () => {
  for (
    const handled of [
      "payout",
      "deposit",
      "round_advance",
      "target_reached",
    ]
  ) {
    assertStrictEquals(isHandledActivity(handled), true);
  }
  assertStrictEquals(isHandledActivity("authorized"), false);
  assertStrictEquals(isHandledActivity(""), false);
});

Deno.test("payout notifies only the recipient address", () => {
  const plan = buildPlan({
    activity_type: "payout",
    poolName: "Round Robin",
    amount: 50_000_000,
    user_address: "GBROJA-ALICE",
    allMembers: MEMBERS,
    description: null,
  });
  assertStrictEquals(plan !== null, true);
  assertEquals(plan!.recipients, ["GBROJA-ALICE"]);
  assertEquals(plan!.prefKey, "email_on_payout");
  assertEquals(plan!.subject, "You received 5.00 XLM from Round Robin");
  assertEquals(plan!.inAppMsg, "You received 5.00 XLM from Round Robin");
});

Deno.test("payout with no actor produces no recipients", () => {
  const plan = buildPlan({
    activity_type: "payout",
    poolName: "Round Robin",
    amount: null,
    user_address: null,
    allMembers: MEMBERS,
    description: null,
  });
  assertEquals(plan!.recipients, []);
});

Deno.test("deposit notifies everyone except the depositor", () => {
  const plan = buildPlan({
    activity_type: "deposit",
    poolName: "Round Robin",
    amount: 10_000_000,
    user_address: "GBROJA-BOB",
    allMembers: MEMBERS,
    description: null,
  });
  assertEquals(plan!.recipients, ["GBROJA-ALICE", "GBROJA-CAROL"]);
  assertEquals(plan!.prefKey, "email_on_deposit");
  assertEquals(plan!.subject, "GBROJA…-BOB deposited to Round Robin");
});

Deno.test("round_advance notifies all members with description as next", () => {
  const plan = buildPlan({
    activity_type: "round_advance",
    poolName: "Round Robin",
    amount: null,
    user_address: "GBROJA-CAROL",
    allMembers: MEMBERS,
    description: "GBROJA-ALICE is the next beneficiary",
  });
  assertEquals(plan!.recipients, MEMBERS);
  assertEquals(plan!.prefKey, "email_on_round");
  assertEquals(
    plan!.subject,
    "Round complete in Round Robin — GBROJA-ALICE is the next beneficiary is next",
  );
});

Deno.test("target_reached notifies all members", () => {
  const plan = buildPlan({
    activity_type: "target_reached",
    poolName: "Green Bottle",
    amount: null,
    user_address: null,
    allMembers: MEMBERS,
    description: null,
  });
  assertEquals(plan!.recipients, MEMBERS);
  assertEquals(plan!.prefKey, "email_on_target");
  assertEquals(
    plan!.subject,
    "Green Bottle reached its target! You can now withdraw.",
  );
});

Deno.test("unhandled activity yields no plan", () => {
  const plan = buildPlan({
    activity_type: "authorized",
    poolName: "Round Robin",
    amount: null,
    user_address: null,
    allMembers: MEMBERS,
    description: null,
  });
  assertStrictEquals(plan, null);
});

Deno.test("shouldSendEmail requires an email address", () => {
  assertStrictEquals(
    shouldSendEmail(undefined, "email_on_payout", "pool-1"),
    false,
  );
  assertStrictEquals(
    shouldSendEmail(profile({ email: null }), "email_on_payout", "pool-1"),
    false,
  );
});

Deno.test("shouldSendEmail respects per-pool mute", () => {
  const muted = profile({
    muted_pools: ["pool-1"],
  });
  assertStrictEquals(
    shouldSendEmail(muted, "email_on_payout", "pool-1"),
    false,
  );
  assertStrictEquals(shouldSendEmail(muted, "email_on_payout", "pool-2"), true);
});

Deno.test("shouldSendEmail respects per-type preference opt-out", () => {
  assertStrictEquals(
    shouldSendEmail(
      profile({ notification_preferences: prefs({ email_on_round: false }) }),
      "email_on_round",
      "pool-1",
    ),
    false,
  );
  assertStrictEquals(
    shouldSendEmail(
      profile({ notification_preferences: prefs({ email_on_round: false }) }),
      "email_on_deposit",
      "pool-1",
    ),
    true,
  );
});

Deno.test("shouldSendEmail defaults unset preferences to true (new columns)", () => {
  const partialPrefs = {
    email_on_payout: false,
  } as unknown as NotificationPreferences;
  assertStrictEquals(
    shouldSendEmail(
      profile({ notification_preferences: partialPrefs }),
      "email_on_round",
      "pool-1",
    ),
    true,
  );
  assertStrictEquals(
    shouldSendEmail(
      profile({ notification_preferences: partialPrefs }),
      "email_on_payout",
      "pool-1",
    ),
    false,
  );
});
