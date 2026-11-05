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
export { SDK_VERSION } from "./version";
