export type TxLogPhase = "build" | "simulate" | "sign" | "submit" | "confirm" | "error";

export interface TxLogEvent {
  phase: TxLogPhase;
  hash?: string | undefined;
  ledger?: number | undefined;
  durationMs?: number | undefined;
  error?: string | undefined;
  message?: string | undefined;
  contract?: string | undefined;
  method?: string | undefined;
}

export type TxLogger = (event: TxLogEvent) => void;

/**
 * Redacts sensitive tokens such as Stellar secret keys (S...) or Bearer tokens.
 */
export function redactSensitiveData(text: string): string {
  if (!text) return text;
  return text
    .replace(/S[A-Z0-9]{55}/g, "S[REDACTED_SECRET_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, "Bearer [REDACTED_TOKEN]");
}

/**
 * Creates a log-safe copy of a TxLogEvent with sensitive fields redacted.
 */
export function createSafeLogEvent(event: TxLogEvent): TxLogEvent {
  const safe: TxLogEvent = { phase: event.phase };
  if (event.hash) safe.hash = event.hash;
  if (event.ledger !== undefined) safe.ledger = event.ledger;
  if (event.durationMs !== undefined) safe.durationMs = event.durationMs;
  if (event.contract) safe.contract = event.contract;
  if (event.method) safe.method = event.method;
  if (event.message) safe.message = redactSensitiveData(event.message);
  if (event.error) safe.error = redactSensitiveData(event.error);
  return safe;
}

/**
 * Backward compatibility alias for createSafeLogEvent.
 */
export const redactTxLogEvent = createSafeLogEvent;

/**
 * Standard reference console logger for transaction phases.
 */
export const consoleTxLogger: TxLogger = (event: TxLogEvent) => {
  const clean = createSafeLogEvent(event);
  const parts = [`[TxLog][${clean.phase.toUpperCase()}]`];
  if (clean.contract) parts.push(`contract=${clean.contract}`);
  if (clean.method) parts.push(`method=${clean.method}`);
  if (clean.hash) parts.push(`hash=${clean.hash.slice(0, 8)}...`);
  if (clean.ledger !== undefined) parts.push(`ledger=${clean.ledger}`);
  if (clean.durationMs !== undefined) parts.push(`${clean.durationMs}ms`);
  if (clean.message) parts.push(`msg=${clean.message}`);
  if (clean.error) parts.push(`error=${clean.error}`);

  console.log(parts.join(" "));
};
