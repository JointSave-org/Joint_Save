/** Phases a transaction passes through. */
export type TxLogPhase =
  | "build"
  | "simulate"
  | "sign"
  | "submit"
  | "confirm"
  | "error";

/**
 * Structured, redacted-by-default transaction log event.
 *
 * Addresses are never included by default; error text is passed through
 * {@link redactText} before it reaches a logger.
 */
export interface TxLogEvent {
  phase: TxLogPhase;
  /** Contract method name (not sensitive). */
  operation?: string | undefined;
  /** Transaction hash — safe to log and required for support. */
  hash?: string | undefined;
  ledger?: number | undefined;
  durationMs?: number | undefined;
  /** Redacted error text. */
  error?: string | undefined;
}

export type TxLogger = (event: TxLogEvent) => void;

export interface TxLoggerOptions {
  /**
   * Opt in to logging addresses in error text. Defaults to `false`.
   * Secrets are always redacted.
   */
  includeAddresses?: boolean;
}

const ADDRESS_PATTERN = /\b[GCS][A-Z2-7]{55}\b/g;
const SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;

/** Redact secret seeds only. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[redacted-secret]");
}

/** Redact Stellar accounts, contract ids, and secret seeds from text. */
export function redactText(text: string): string {
  return redactSecrets(text).replace(ADDRESS_PATTERN, (match) => `${match[0]}…[redacted]`);
}

/** Return a copy of `event` with addresses/secrets removed from error text. */
export function redactLogEvent(event: TxLogEvent): TxLogEvent {
  const redacted: TxLogEvent = { phase: event.phase };
  if (event.operation !== undefined) redacted.operation = event.operation;
  if (event.hash !== undefined) redacted.hash = event.hash;
  if (event.ledger !== undefined) redacted.ledger = event.ledger;
  if (event.durationMs !== undefined) redacted.durationMs = event.durationMs;
  if (event.error !== undefined) redacted.error = redactText(event.error);
  return redacted;
}

/**
 * Wrap a logger so every event is redacted unless `includeAddresses` is true.
 * Secrets are always redacted.
 */
export function createRedactingLogger(
  logger: TxLogger,
  options: TxLoggerOptions = {}
): TxLogger {
  return (event) => {
    if (options.includeAddresses) {
      logger({ ...event, ...(event.error !== undefined ? { error: redactSecrets(event.error) } : {}) });
      return;
    }
    logger(redactLogEvent(event));
  };
}

/** Reference logger that writes a single line per phase via `console`. */
export const consoleTxLogger: TxLogger = (event) => {
  const safe = redactLogEvent(event);
  const fields = [
    `phase=${safe.phase}`,
    safe.operation ? `operation=${safe.operation}` : undefined,
    safe.hash ? `hash=${safe.hash}` : undefined,
    safe.ledger !== undefined ? `ledger=${safe.ledger}` : undefined,
    safe.durationMs !== undefined ? `durationMs=${safe.durationMs}` : undefined,
    safe.error ? `error=${safe.error}` : undefined,
  ].filter((field): field is string => field !== undefined);

  const line = `[jointsave:sdk] ${fields.join(" ")}`;
  if (safe.phase === "error") console.error(line);
  else console.info(line);
};
