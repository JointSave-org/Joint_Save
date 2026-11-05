import { rpc, scValToNative, type xdr } from "@stellar/stellar-sdk";
import {
  classifyContractError,
  mapContractError,
  type ContractErrorDiagnostic,
} from "../diagnostics/contract-errors";
import { redactText } from "../diagnostics/logger";
import { sleep } from "../utils/time";
import { isRetryable } from "./retry";

export type TxLookupState = "pending" | "success" | "failed" | "not_found" | "timeout";

/**
 * Result of looking a transaction hash up by hand.
 *
 * Lookups never throw raw RPC errors; transport failures are reported as
 * `timeout` with a redacted `error` string.
 */
export interface TxLookup {
  hash: string;
  state: TxLookupState;
  ledger?: number | undefined;
  /** Stellar transaction result code, e.g. `txFailed` or `txBadSeq`. */
  resultCode?: string | undefined;
  contractError?: ContractErrorDiagnostic | undefined;
  /** Redacted transport error, when the lookup could not complete. */
  error?: string | undefined;
}

/** Minimal server surface required to look up a transaction. */
export interface TransactionLookupServer {
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

export interface LookupTransactionOptions {
  server: TransactionLookupServer;
  /** Total time to keep polling. `0` performs a single check. Default: `30000`. */
  timeoutMs?: number;
  /** Delay between checks. Default: `1000`. */
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

/**
 * Poll for a transaction by hash.
 *
 * - `success` / `failed` — the network has a result.
 * - `not_found` — a single check saw `NOT_FOUND`.
 * - `pending` — polling ended while the transaction was still unknown.
 * - `timeout` — polling ended because RPC calls were failing.
 *
 * Never throws; use `TxLookup.error` to inspect transport failures.
 */
export async function lookupTransaction(
  hash: string,
  options: LookupTransactionOptions
): Promise<TxLookup> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const started = Date.now();

  let sawNotFound = false;
  let lastError: unknown;

  for (;;) {
    try {
      const result = await options.server.getTransaction(hash);
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        const lookup: TxLookup = { hash, state: "success", ledger: result.ledger };
        return lookup;
      }

      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        const lookup: TxLookup = { hash, state: "failed", ledger: result.ledger };
        const resultCode = resultCodeOf(result.resultXdr);
        if (resultCode !== undefined) lookup.resultCode = resultCode;
        const contractError = contractErrorFromDiagnostics([
          ...(result.diagnosticEventsXdr ?? []),
          ...metaDiagnosticEvents(result.resultMetaXdr),
        ]);
        if (contractError !== undefined) lookup.contractError = contractError;
        return lookup;
      }

      sawNotFound = true;
      if (timeoutMs === 0) return { hash, state: "not_found" };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || Date.now() - started >= timeoutMs) {
        return timeoutLookup(hash, lastError);
      }
    }

    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) {
      if (sawNotFound) return { hash, state: "pending" };
      return timeoutLookup(hash, lastError);
    }

    await sleep(Math.min(pollIntervalMs, timeoutMs - elapsed));
  }
}

function timeoutLookup(hash: string, error: unknown): TxLookup {
  const lookup: TxLookup = { hash, state: "timeout" };
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message) lookup.error = redactText(message);
  return lookup;
}

function resultCodeOf(resultXdr: xdr.TransactionResult | undefined): string | undefined {
  if (!resultXdr) return undefined;
  try {
    return resultXdr.result().switch().name;
  } catch {
    return undefined;
  }
}

function contractErrorFromDiagnostics(
  events: xdr.DiagnosticEvent[] | undefined
): ContractErrorDiagnostic | undefined {
  const text = diagnosticText(events);
  if (!text) return undefined;

  const classified = classifyContractError(text);
  if (classified) return classified;
  return mapContractError(text);
}

function metaDiagnosticEvents(meta: xdr.TransactionMeta | undefined): xdr.DiagnosticEvent[] {
  if (!meta) return [];
  try {
    return meta.v3().sorobanMeta()?.diagnosticEvents() ?? [];
  } catch {
    return [];
  }
}

function diagnosticText(events: xdr.DiagnosticEvent[] | undefined): string | undefined {
  if (!events || events.length === 0) return undefined;

  const parts: string[] = [];
  for (const event of events) {
    if (parts.length > 50) break;
    try {
      const body = event.event().body().v0();
      for (const topic of body.topics()) collectScValText(topic, parts);
      collectScValText(body.data(), parts);
    } catch {
      // Malformed diagnostic events must not break a lookup.
    }
  }

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function collectScValText(value: xdr.ScVal, out: string[]): void {
  let native: unknown;
  try {
    native = scValToNative(value);
  } catch {
    return;
  }
  collectText(native, out, 0);
}

function collectText(value: unknown, out: string[], depth: number): void {
  if (depth > 6 || out.length > 50) return;

  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return;
  }

  if (value instanceof Uint8Array) {
    const text = Buffer.from(value).toString("utf8");
    if (text.length > 0 && /^[\x20-\x7e]+$/.test(text)) out.push(text);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1);
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectText(item, out, depth + 1);
  }
}
