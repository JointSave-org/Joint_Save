/**
 * The single public entry point for `@jointsave/sdk`.
 *
 * Integrators must import from the package root (`@jointsave/sdk`) only.
 * Deep imports (`@jointsave/sdk/dist/...`) are unsupported and may break
 * without a major version bump.
 *
 * Every symbol re-exported here is part of the public API and is checked by
 * `pnpm check:api`. Add new exports deliberately and keep internal helpers
 * out of this barrel.
 */

export * from "./constants";
export * from "./types";
export * from "./config";

// Utilities — pure, tree-shakeable, no network code.
export * from "./utils";

// ScVal encoders for building custom contract calls.
export * from "./scval";

// Typed errors.
export * from "./errors";

// Soroban contract clients and the JointSaveClient facade.
export * from "./client";

// Pure, deterministic action-eligibility gating.
export * from "./gating";

// Log-safe diagnostics: error taxonomy, simulation summary, redacted logging.
export * from "./diagnostics";

// Retry classification and transaction-hash recovery.
export * from "./recovery";

export { SDK_VERSION } from "./version";
