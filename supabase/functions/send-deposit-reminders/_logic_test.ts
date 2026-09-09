import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  addHours,
  eligibleReminderRecipients,
  emailAllowed,
  emailHtml,
  nonDepositors,
  normalizeAddress,
  reminderMessage,
  subtractSeconds,
  type UserProfile,
} from "./_logic.ts";

const DEADLINE = new Date("2026-09-09T18:00:00Z");

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    wallet_address: "GBROJADEADBEEFALICE",
    email: "alice@example.com",
    notification_preferences: null,
    ...over,
  };
}

Deno.test("normalizeAddress lowercases", () => {
  assertEquals(normalizeAddress("GABCDEF..."), "gabcdef...");
  assertStrictEquals(normalizeAddress(""), "");
});

Deno.test("addHours shifts a date forward", () => {
  const base = new Date("2026-09-09T12:00:00Z");
  assertEquals(addHours(base, 24), new Date("2026-09-10T12:00:00Z"));
});

Deno.test("subtractSeconds shifts a date backward", () => {
  const base = new Date("2026-09-09T18:00:00Z");
  assertEquals(
    subtractSeconds(base, 7 * 24 * 60 * 60),
    new Date("2026-09-02T18:00:00Z"),
  );
});

Deno.test("emailAllowed requires an email address", () => {
  assertStrictEquals(emailAllowed(undefined), false);
  assertStrictEquals(emailAllowed(profile({ email: null })), false);
});

Deno.test("emailAllowed defaults new prefs to opted-in", () => {
  assertStrictEquals(emailAllowed(profile()), true);
});

Deno.test("emailAllowed honors explicit opt-outs", () => {
  assertStrictEquals(
    emailAllowed(
      profile({ notification_preferences: { email_on_deposit: false } }),
    ),
    false,
  );
  assertStrictEquals(
    emailAllowed(
      profile({
        notification_preferences: { email_on_deposit_reminder: false },
      }),
    ),
    false,
  );
  assertStrictEquals(
    emailAllowed(
      profile({
        notification_preferences: {
          email_on_deposit: true,
          email_on_deposit_reminder: true,
        },
      }),
    ),
    true,
  );
});

Deno.test("emailAllowed ignores unrelated prefs", () => {
  assertStrictEquals(
    emailAllowed(
      profile({
        notification_preferences: {
          email_on_payout: false,
          email_on_round: false,
          email_on_target: false,
        },
      }),
    ),
    true,
  );
});

Deno.test("reminderMessage embeds pool name and deadline", () => {
  const msg = reminderMessage("Round Robin", DEADLINE);
  assertEquals(
    msg,
    "Deposit reminder: Round Robin round deadline is 2026-09-09T18:00:00.000Z",
  );
});

Deno.test("emailHtml contains pool name and deadline", () => {
  const html = emailHtml("Round Robin", DEADLINE);
  assertStrictEquals(html.includes("Round Robin"), true);
  assertStrictEquals(html.includes("2026-09-09T18:00:00.000Z"), true);
});

Deno.test("nonDepositors keeps members absent from depositor set, preserving order", () => {
  const members = ["alice", "bob", "carol"];
  const depositors = new Set(["alice", "carol"]);
  assertEquals(nonDepositors(members, depositors), ["bob"]);
});

Deno.test("nonDepositors is empty when everyone has deposited", () => {
  const members = ["alice", "bob"];
  const depositors = new Set(["alice", "bob"]);
  assertEquals(nonDepositors(members, depositors), []);
});

Deno.test("nonDepositors keeps all members when nobody deposited", () => {
  const members = ["alice", "bob"];
  assertEquals(nonDepositors(members, new Set()), ["alice", "bob"]);
});

Deno.test("nonDepositors is case-sensitive (addresses are pre-normalized)", () => {
  const members = ["ALICE"];
  const depositors = new Set(["alice"]);
  assertEquals(nonDepositors(members, depositors), ["ALICE"]);
});

Deno.test("eligibleReminderRecipients filters by profile + email prefs", () => {
  const alice = profile({
    wallet_address: "alice",
    email: "alice@example.com",
  });
  const bob = profile({
    wallet_address: "bob",
    email: "bob@example.com",
    notification_preferences: { email_on_deposit_reminder: false },
  });
  const map = new Map<string, UserProfile>([
    ["alice", alice],
    ["bob", bob],
  ]);
  const recipients = eligibleReminderRecipients(
    ["alice", "bob", "carol"],
    map,
  );
  assertEquals(recipients, ["alice"]);
});
