import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  isInBackoff,
  makeRetryDecision,
  RETRY_BACKOFF_MINUTES,
  scValToBigInt,
} from "./_logic.ts";

function fakeU64(n: number | bigint) {
  return {
    switch: () => ({ name: "scvU64" }),
    u64: () => ({ toString: () => n.toString() }),
  };
}

function fakeI64(n: number | bigint) {
  return {
    switch: () => ({ name: "scvI64" }),
    i64: () => ({ toString: () => n.toString() }),
  };
}

function fakeUnhandled() {
  return { switch: () => ({ name: "scvVoid" }) };
}

const NOW = new Date("2026-09-09T12:00:00Z");

Deno.test("retry backoff windows are [1, 5, 15] minutes", () => {
  assertEquals(RETRY_BACKOFF_MINUTES, [1, 5, 15]);
});

Deno.test("scValToBigInt decodes u64", () => {
  assertEquals(scValToBigInt(fakeU64(42)), 42n);
  assertEquals(scValToBigInt(fakeU64(9007199254740993n)), 9007199254740993n);
});

Deno.test("scValToBigInt decodes i64 (incl. negatives)", () => {
  assertEquals(scValToBigInt(fakeI64(-7)), -7n);
  assertEquals(scValToBigInt(fakeI64(0)), 0n);
});

Deno.test("scValToBigInt defaults unhandled scvals to 0n", () => {
  assertEquals(scValToBigInt(fakeUnhandled()), 0n);
});

Deno.test("fresh pool: first retry uses 1-minute backoff", () => {
  const d = makeRetryDecision(0, RETRY_BACKOFF_MINUTES, NOW);
  assertStrictEquals(d.exhausted, false);
  assertEquals(d.backoffMinutes, 1);
  assertEquals(d.nextRetryAt, new Date("2026-09-09T12:01:00Z").toISOString());
});

Deno.test("second retry uses 5-minute backoff", () => {
  const d = makeRetryDecision(1, RETRY_BACKOFF_MINUTES, NOW);
  assertStrictEquals(d.exhausted, false);
  assertEquals(d.backoffMinutes, 5);
  assertEquals(d.nextRetryAt, new Date("2026-09-09T12:05:00Z").toISOString());
});

Deno.test("third retry uses 15-minute backoff", () => {
  const d = makeRetryDecision(2, RETRY_BACKOFF_MINUTES, NOW);
  assertStrictEquals(d.exhausted, false);
  assertEquals(d.backoffMinutes, 15);
  assertEquals(d.nextRetryAt, new Date("2026-09-09T12:15:00Z").toISOString());
});

Deno.test("after 3 retries the pool is exhausted (permanent failure)", () => {
  const d = makeRetryDecision(3, RETRY_BACKOFF_MINUTES, NOW);
  assertStrictEquals(d.exhausted, true);
  assertStrictEquals(d.backoffMinutes, null);
  assertStrictEquals(d.nextRetryAt, null);
});

Deno.test("isInBackoff only when next_retry_at is in the future", () => {
  const future = new Date("2026-09-09T12:01:00Z").toISOString();
  const past = new Date("2026-09-09T11:59:00Z").toISOString();
  assertStrictEquals(isInBackoff(future, NOW), true);
  assertStrictEquals(isInBackoff(past, NOW), false);
  assertStrictEquals(isInBackoff(null, NOW), false);
  assertStrictEquals(isInBackoff(undefined, NOW), false);
});

Deno.test("retry counting matches the original inline semantics", () => {
  // attemptNumber logged = 2 → a third failure exhausts (len 3) and records retry_count 3.
  const d = makeRetryDecision(2, RETRY_BACKOFF_MINUTES, NOW);
  assertStrictEquals(d.exhausted, false);
  // attemptNumber = 3 (already logged 3 retries) → exhausted.
  const d2 = makeRetryDecision(3, RETRY_BACKOFF_MINUTES, NOW);
  assertStrictEquals(d2.exhausted, true);
});
