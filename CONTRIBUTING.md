# Contributing to JointSave

Thank you for your interest in JointSave! We welcome contributions from everyone. This guide will help you get started.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Project Structure](#project-structure)
- [Smart Contract Development](#smart-contract-development)
- [Frontend Development](#frontend-development)
- [Coding Conventions](#coding-conventions)
- [PR Process](#pr-process)
- [Issue Labels](#issue-labels)

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Frontend dev server & tooling |
| Rust toolchain | 1.85.0 (via `rust-toolchain.toml`) | Soroban smart contracts |
| Stellar CLI | latest | Contract build, deploy, and test |
| Freighter wallet | latest (browser ext.) | Stellar wallet for dApp interaction |
| pnpm | latest (recommended) | Frontend package manager |

- **Rust**: Install via [rustup](https://rustup.rs/)
- **Stellar CLI**: `cargo install stellar-cli` or follow the [Stellar docs](https://developers.stellar.org/docs/build/smart-contracts/install)
- **Freighter**: [Chrome extension](https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk) or [Firefox add-on](https://addons.mozilla.org/en-US/firefox/addon/freighter/)
- **pnpm**: `npm install -g pnpm` or [other install methods](https://pnpm.io/installation)

## Local Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/JointSave-org/Joint_Save.git
cd Joint_Save
```

### Smart Contracts

```bash
cd smartcontract
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

### Frontend

```bash
cd frontend
pnpm install
cp .env.example .env.local
# Edit .env.local using the comments in .env.example for value sources.
```

## Project Structure

```
Joint_Save/
├── frontend/            # Next.js web application
│   ├── app/             # App router pages & API routes
│   ├── components/      # React components (shadcn/ui based)
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Utilities (supabase client, helpers)
│   └── public/          # Static assets
├── smartcontract/       # Soroban Rust workspace
│   ├── contracts/       # Individual contract crates
│   │   ├── factory/     # JointSaveFactory (deployment & mgmt)
│   │   ├── rotational/  # Rotational savings pool
│   │   ├── target/      # Target savings pool
│   │   └── flexible/    # Flexible savings pool
│   ├── scripts/         # Deploy & management scripts
│   └── deployments/     # Deployed contract addresses
├── docs/                # Documentation & screenshots
├── .github/             # CI workflows & PR templates
└── README.md
```

## Smart Contract Development

Contracts use [Soroban](https://developers.stellar.org/docs/smart-contracts), Stellar's smart contract platform.

### Build

```bash
cd smartcontract
cargo build --target wasm32-unknown-unknown --release
```

Build a specific contract:

```bash
cargo build --target wasm32-unknown-unknown --release --manifest-path contracts/factory/Cargo.toml
```

### Test

```bash
cd smartcontract
cargo test
```

Test a specific contract:

```bash
cargo test -p jointsave-factory
```

### Deploy Locally

Start a local Soroban network with [stellar-cli](https://developers.stellar.org/docs/build/smart-contracts/getting-started):

```bash
stellar network start
```

Then deploy:

```bash
cd smartcontract
bash scripts/deploy.sh
```

Update `frontend/.env.local` with the contract IDs and WASM hashes printed by the script.

### Pin Incompatible Dependencies

If you encounter build errors, pin the dependency versions used in CI:

```bash
cargo update serde_with@3.18.0 --precise 3.17.0
cargo update darling@0.23.0 --precise 0.21.3
cargo update indexmap@2.14.0 --precise 2.6.0
```

## Frontend Development

### Dev Server

```bash
cd frontend
pnpm dev
```

Opens at [http://localhost:3000](http://localhost:3000).

### Build

```bash
pnpm build
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

`frontend/.env.example` includes inline comments for each variable, including where to find Supabase values, deployed Stellar contract IDs, and WASM hashes. The frontend imports `lib/env.ts` from the root layout, so missing required variables throw a clear startup error before a downstream component fails.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous API key |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Soroban RPC endpoint |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Stellar Horizon endpoint |
| `NEXT_PUBLIC_FACTORY_CONTRACT_ID` | Deployed factory contract ID |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | Token contract ID (use `native` for XLM) |
| `NEXT_PUBLIC_ROTATIONAL_WASM_HASH` | Rotational pool WASM hash |
| `NEXT_PUBLIC_TARGET_WASM_HASH` | Target pool WASM hash |
| `NEXT_PUBLIC_FLEXIBLE_WASM_HASH` | Flexible pool WASM hash |

### Lint

```bash
pnpm lint
```

## Coding Conventions

### Rust (Smart Contracts)

- Format with `cargo fmt` before committing
- Follow standard Rust naming conventions (snake_case for functions/variables, CamelCase for types)
- Run `cargo clippy` and address warnings

```bash
cd smartcontract
cargo fmt
cargo clippy
```

### TypeScript (Frontend)

- The project uses Next.js's built-in ESLint (`next lint`)
- Format with Prettier (add a `.prettierrc` at the frontend root if desired)
- Use the `@/` path alias for imports (e.g. `import { Button } from "@/components/ui/button"`)
- Follow existing patterns in the codebase

```bash
cd frontend
pnpm lint
```

## PR Process

### Branch Naming

Use descriptive branch names with a type prefix:

- `feat/` — new features (e.g. `feat/add-dark-mode`)
- `fix/` — bug fixes (e.g. `fix/wallet-connection-error`)
- `chore/` — maintenance, tooling, dependencies (e.g. `chore/update-deps`)

### Commit Messages

Use conventional commits:

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`

Examples:
- `feat(frontend): add group detail page`
- `fix(contract): prevent overflow in withdraw calculation`
- `chore(deps): update soroban-sdk to v21`

### Before Submitting

1. Ensure the project builds successfully
2. Run tests: `cargo test` (contracts) and `pnpm build` (frontend)
3. Format your code: `cargo fmt` and `pnpm lint`
4. Keep PRs focused — one feature/fix per PR
5. Write a clear PR description following the template

### Review Process

- At least one maintainer review is required
- Address feedback with additional commits (no force-push while reviewing)
- Once approved, a maintainer will merge your PR

## Issue Labels

| Label | Meaning |
|-------|---------|
| `bug` | Something isn't working as expected |
| `enhancement` | Feature request or improvement |
| `good first issue` | Beginner-friendly task |
| `help wanted` | Looking for contributors |
| `frontend` | Related to the Next.js app |
| `smart-contract` | Related to Soroban contracts |
| `documentation` | Docs, comments, or guides |
| `question` | Discussion or inquiry |
| `wontfix` | Will not be addressed |
| `duplicate` | Already covered by another issue |
