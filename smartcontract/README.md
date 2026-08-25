# JointSave – Smart Contracts (Stellar Soroban)

Soroban smart contracts powering JointSave on the Stellar network.

## Contracts

| Contract     | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `factory`    | Registry for all deployed JointSave pools                       |
| `rotational` | Rotational savings pool – members take turns receiving payouts  |
| `target`     | Goal-based savings pool – funds unlock when target is reached   |
| `flexible`   | Flexible deposit/withdraw pool with optional yield distribution |

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) with `wasm32-unknown-unknown` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)

```bash
rustup target add wasm32-unknown-unknown
```

## Build

```bash
stellar contract build
```

Compiled `.wasm` files land in `target/wasm32-unknown-unknown/release/`.

## Deploy (Testnet)

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Copy the output contract IDs into your frontend `.env`.

## API Reference

Full API reference for all four contracts — functions, events, storage keys, error conditions, and CLI examples:

**[docs/contract-api.md](../docs/contract-api.md)**

## Network

- **Testnet RPC:** `https://soroban-testnet.stellar.org`
- **Explorer:** [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet)
- **Horizon:** `https://horizon-testnet.stellar.org`

## Property-Based Fuzz Testing

The contracts include property-based fuzz tests using [`proptest`](https://github.com/proptest-rs/proptest) to systematically verify arithmetic invariants across thousands of random inputs.

### What is tested

| Property                       | Contract     | Description                                                                                                                 |
| ------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Fee split conservation         | `rotational` | `treasury_cut + relayer_cut + payout == total_collected` for any valid fee combination — no rounding leaks                  |
| Zero-fee payout                | `rotational` | When both fees are 0%, 100% of `total_collected` reaches the beneficiary                                                    |
| 100%-fee sum                   | `rotational` | Even at maximum fees, the three parts still sum exactly to `total_collected`                                                |
| `remove_member` round validity | `rotational` | After any valid removal, `current_round` is always a valid index in the updated member list, or the pool is marked complete |
| Future-member removal          | `rotational` | Removing a member whose turn hasn't come yet never changes `current_round`                                                  |
| Past-member removal            | `rotational` | Removing a member whose turn has passed decrements `current_round` by exactly 1                                             |
| Deposit sum exactness          | `target`     | `total_deposited` always equals the exact sum of all deposits — no rounding loss or double-counting                         |
| No overcounting                | `target`     | `total_deposited` never exceeds the sum of individual deposit amounts                                                       |
| Unlock is sticky               | `target`     | Once the pool unlocks (`total_deposited >= target_amount`), additional deposits never re-lock it                            |

### Running the fuzz tests

```bash
# Run all property tests (default: 256 cases per test)
cargo test prop_

# Run with more cases for deeper coverage
PROPTEST_CASES=10000 cargo test prop_
```

### Location

`contracts/rotational/src/fuzz_tests.rs`
