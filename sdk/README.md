# @jointsave/sdk

Typed TypeScript client for [JointSave](https://github.com/JointSave-org/Joint_Save) savings pools on Stellar Soroban.

> Status: early scaffolding (`0.x`). The public API is being built out; expect additions until `1.0`.

## Install

```bash
pnpm add @jointsave/sdk
```

## Usage

Import from the package root only:

```ts
import { SDK_VERSION } from "@jointsave/sdk";

console.log(SDK_VERSION);
```

Deep imports (`@jointsave/sdk/dist/...`) are unsupported and may change without a major version bump.

## Development

This package is standalone and has its own lockfile.

```bash
cd sdk
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build         # emit dist/ + .d.ts
pnpm test          # vitest
pnpm check:api     # fail if internal symbols leak from the root barrel
```

## Public API policy

- `src/index.ts` is the only public entry point.
- New exports are deliberate and reviewed; internal helpers stay unexported.
- `pnpm check:api` fails the build when a denylisted symbol is exported from the root.
- Breaking changes require a major version bump and a migration note.

## License

MIT
