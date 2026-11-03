/**
 * @jointsave/sdk - Official TypeScript SDK for the JointSave protocol.
 *
 * Single supported entry point for third-party integrators, wallets, and bots.
 */

export const SDK_VERSION = '0.1.0' as const;

// ── Utilities Group ──────────────────────────────────────────────────────────

export {
  toBaseUnits,
  fromBaseUnits,
  usdcToStroops,
  stroopsToUsdc,
  formatTokenAmount,
  formatUsdc,
  formatPercent,
  type FormatTokenAmountOptions,
} from './utils/amounts.js';

export {
  isValidStellarAccount,
  isValidContractId,
  isValidSorobanAddress,
  shortAddress,
  type ShortAddressOptions,
} from './utils/address.js';

export {
  SECONDS_PER_LEDGER,
  SECONDS_PER_DAY,
  LEDGERS_PER_DAY,
  daysToLedgers,
  ledgersToDays,
  ledgerToTimestamp,
  estimateLedgerAt,
  isPastDeadline,
  sleep,
} from './utils/time.js';
