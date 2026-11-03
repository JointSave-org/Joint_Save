# @jointsave/sdk

The official TypeScript SDK for the [JointSave](https://github.com/JointSave-org/Joint_Save) decentralized community savings protocol on Stellar/Soroban.

## Features

- **BigInt-Safe Amounts**: Lossless conversions between human-readable strings and integer base units (stroops). No float drift.
- **StrKey Address Validation**: Strict validation for Stellar accounts (`G...`) and Soroban contracts (`C...`), preserving case-sensitivity.
- **Ledger & Time Utilities**: Helpers for block timing (~5s ledgers), sequence estimation, and deadline verification.
- **Zero Dependencies**: Core utilities operate without external runtime dependencies for maximum tree-shakeability and cross-environment compatibility (Node, Bun, browser).

## Installation

```bash
pnpm add @jointsave/sdk
# or
npm install @jointsave/sdk
```

## Quick Start

```typescript
import {
  toBaseUnits,
  fromBaseUnits,
  usdcToStroops,
  isValidStellarAccount,
  isValidContractId,
  daysToLedgers,
  shortAddress
} from '@jointsave/sdk';

// 1. Amount Conversions (Stellar has 7 decimals)
const stroops = toBaseUnits("125.50", 7); // 1255000000n
const display = fromBaseUnits(stroops, 7); // "125.5"

// 2. Address Validation
const isAccount = isValidStellarAccount("GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSBR54IS4NGNBCITVIYBCQMGVRU"); // true
const isContract = isValidContractId("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"); // true
const short = shortAddress("GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSBR54IS4NGNBCITVIYBCQMGVRU"); // "GAHK7E…GVRU"

// 3. Ledger Cadence & Estimation
const ledgers = daysToLedgers(7); // ~120960 ledgers
```

## Testing & Verification

```bash
pnpm run test        # Runs vitest unit & boundary suite
pnpm run typecheck   # Strictly verifies TypeScript types
pnpm run build       # Compiles library to dist/
pnpm run check:api   # Asserts public API boundary and leaks
```

## License

MIT © JointSave Contributors
