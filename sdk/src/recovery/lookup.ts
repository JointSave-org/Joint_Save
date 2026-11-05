import { rpc } from "@stellar/stellar-sdk";
import type { SorobanServer } from "../client/base";

export type TxLookupStatus = "pending" | "success" | "failed" | "not_found" | "timeout";

export interface TxLookup {
  hash: string;
  status: TxLookupStatus;
  ledger?: number | undefined;
  resultXdr?: string | undefined;
  resultMetaXdr?: string | undefined;
  error?: string | undefined;
  diagnosticEventsXdr?: string[] | undefined;
  raw?: unknown;
}

export interface LookupTransactionOptions {
  server: SorobanServer;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function extractXdr(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof (val as { toXDR: (format?: string) => string }).toXDR === "function") {
    return (val as { toXDR: (format?: string) => string }).toXDR("base64");
  }
  if (typeof val === "string") return val;
  return undefined;
}

/**
 * Recovers transaction status by hash without throwing raw RPC errors.
 */
export async function lookupTransaction(
  hash: string,
  options: LookupTransactionOptions
): Promise<TxLookup> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const started = Date.now();

  while (Date.now() - started <= timeoutMs) {
    try {
      const resp = (await options.server.getTransaction(hash)) as unknown as {
        status: string | rpc.Api.GetTransactionStatus;
        ledger?: number;
        resultXdr?: unknown;
        resultMetaXdr?: unknown;
        error?: string;
      };

      const status = String(resp.status).toUpperCase();

      if (
        status === "SUCCESS" ||
        status === String(rpc.Api.GetTransactionStatus.SUCCESS).toUpperCase()
      ) {
        return {
          hash,
          status: "success",
          ledger: resp.ledger,
          resultXdr: extractXdr(resp.resultXdr),
          resultMetaXdr: extractXdr(resp.resultMetaXdr),
          raw: resp,
        };
      }

      if (
        status === "FAILED" ||
        status === String(rpc.Api.GetTransactionStatus.FAILED).toUpperCase()
      ) {
        return {
          hash,
          status: "failed",
          ledger: resp.ledger,
          resultXdr: extractXdr(resp.resultXdr),
          resultMetaXdr: extractXdr(resp.resultMetaXdr),
          error: resp.error || "Transaction execution failed on ledger",
          raw: resp,
        };
      }

      if (
        status === "NOT_FOUND" ||
        status === String(rpc.Api.GetTransactionStatus.NOT_FOUND).toUpperCase()
      ) {
        // Pending in mempool or not yet indexed
      }
    } catch {
      // Absorb transient lookup errors, continue polling
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return {
    hash,
    status: "timeout",
    error: `Transaction lookup timed out after ${timeoutMs}ms`,
  };
}
