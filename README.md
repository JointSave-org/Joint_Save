<div align="center">
  <img src="frontend/public/joint-save.jpg" alt="JointSave Logo" width="120" height="120" style="border-radius: 20px;">
  
  # JointSave

  [![CI – Build & Test Soroban Contracts](https://github.com/Sendi0011/Joint_Save/actions/workflows/test.yml/badge.svg)](https://github.com/Sendi0011/Joint_Save/actions/workflows/test.yml)

  A decentralized community savings platform built on Stellar, enabling trusted groups to automate contributions, payouts, and transparency using Soroban smart contracts.
</div>

## Live Demo

🚀 **[https://joint-save.vercel.app](https://joint-save.vercel.app)**

📹 **Demo Video:** [Watch Full MVP Functionality](https://youtu.be/Iuy-As9im7A)

---

## Overview

Across the world, millions of people rely on informal savings groups to pool money and support one another. While these systems foster trust and cooperation, they often face problems like missed payments, fraud, and lack of transparency.

**JointSave solves this by putting savings groups on-chain — on Stellar.** Funds are managed by Soroban smart contracts, ensuring automation, transparency, and fairness for everyone.

## Key Features

### Three Savings Models

- **🔄 Rotational Mode** – Members take turns receiving the full pool payout
- **🎯 Target Pool Mode** – Groups save toward a shared goal with automatic unlock
- **💰 Flexible Pool Mode** – Members deposit anytime with optional yield distribution

### Core Capabilities

- **🏭 Inter-Contract Architecture** – Factory contract coordinates all pool contracts on-chain
- **🔒 Trustless Escrow** – Every group is governed by a Soroban smart contract
- **📊 Complete Transparency** – Every transaction is verifiable on Stellar
- **⚡ Automated Enforcement** – Smart contracts handle payouts, penalties, and deadlines
- **📱 Mobile-First Design** – Fully responsive interface optimized for all devices

## Architecture

JointSave uses a factory pattern with four smart contracts:

- **Factory Contract** – Central registry for all deployed pools
- **Rotational Pool** – Fixed deposits, rotating payouts
- **Target Pool** – Goal-based savings with deadline
- **Flexible Pool** – Variable deposits with yield options

The frontend is built with Next.js and integrates with multiple Stellar wallets through the Stellar Wallets Kit.

## Technology Stack

### Smart Contracts
- **Rust** with Soroban SDK for smart contract development
- **WebAssembly (WASM)** compilation for efficient execution
- **Stellar Testnet** for secure, low-cost transactions

### Frontend
- **Next.js 14** with App Router for modern React development
- **TypeScript** for type-safe development
- **Tailwind CSS** for responsive, mobile-first styling
- **shadcn/ui** for consistent component library
- **Stellar SDK** for blockchain interactions
- **Stellar Wallets Kit** for multi-wallet support

### Infrastructure
- **Vercel** for frontend deployment and hosting
- **Supabase** for off-chain metadata and user data
- **GitHub Actions** for automated CI/CD pipeline

## Deployed Contracts

All contracts are deployed on **Stellar Testnet**:

| Contract | Address |
|----------|---------|
| **Factory** | `CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI` |
| **Rotational WASM** | `d350a325d8734263a3d7150c875555d8956e13a527fb3497d5141b8b3f3d2c74` |
| **Target WASM** | `133a62226501fc5443e70007d79deeeb0b33fdf8c85c7fcd3cf16293bb5c7292` |
| **Flexible WASM** | `df6ff088fd79f13d8d03e72160434517fdb4a83b8c7bfdd887be4369805e0d6b` |

*Deployed on April 16, 2026*

For complete API documentation — functions, events, storage keys, error conditions, and CLI examples — see **[docs/contract-api.md](docs/contract-api.md)**.

## Getting Started

### Prerequisites

- Node.js 18+ and npm/pnpm
- Rust toolchain with `wasm32-unknown-unknown` target
- Stellar CLI
- A Stellar wallet (Freighter, xBull, Albedo, or Lobstr)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/Sendi0011/Joint_Save.git
   cd Joint_Save
   ```

2. **Set up the frontend**
   ```bash
   cd frontend
   npm install
   cp .env.example .env.local
   ```

3. **Configure environment variables**
   Use the inline comments in `frontend/.env.example` as the source of truth for each value. The frontend validates required variables during startup, so missing values fail fast with a clear `Missing required env var: ...` error.

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
   NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
   NEXT_PUBLIC_FACTORY_CONTRACT_ID=CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI
   NEXT_PUBLIC_TOKEN_CONTRACT_ID=native
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Access the application**
   Open [http://localhost:3000](http://localhost:3000) in your browser

### Running E2E Tests

The frontend has a Playwright end-to-end suite covering the critical user flows
(create pool, deposit, wallet connect, navigation, responsive layout).

```bash
cd frontend
pnpm install
pnpm exec playwright install chromium   # one-time browser download
pnpm test:e2e                           # headless run (Playwright starts the dev server)
pnpm test:e2e:ui                        # interactive UI mode
```

The suite is fully deterministic — it mocks the `/api/pools` boundary and uses a
test-gated wallet/RPC seam (`NEXT_PUBLIC_E2E`), so it needs **no** live Soroban
network, wallet extension, or Supabase project. It runs on every PR via
[`.github/workflows/e2e.yml`](.github/workflows/e2e.yml). See
[frontend/e2e/README.md](frontend/e2e/README.md) for the design, the flaky-test
policy, and details.

### Smart Contract Development

To work with the smart contracts:

```bash
cd smartcontract

# Install Rust target for WASM
rustup target add wasm32-unknown-unknown

# Build all contracts
stellar contract build

# Deploy to testnet (requires funded account)
./scripts/deploy.sh
```

## How It Works

### For Users

1. **Connect Wallet** – Use any supported Stellar wallet
2. **Create or Join Group** – Set up a savings pool with friends or colleagues
3. **Make Contributions** – Deposit funds according to your group's schedule
4. **Receive Payouts** – Get funds automatically when it's your turn or goal is reached
5. **Track Progress** – Monitor your group's activity and balances in real-time

### For Developers

JointSave demonstrates several advanced Soroban patterns:

- **Factory Pattern** – Central registry for contract discovery
- **Inter-Contract Calls** – Contracts communicating with each other
- **Hybrid Architecture** – Combining on-chain logic with off-chain metadata
- **Multi-Wallet Integration** – Supporting various Stellar wallets
- **Real-Time State** – Live balance updates from blockchain

## Screenshots

<div align="center">



### Desktop Features
![CI/CD Pipeline](docs/ci-screenshot.png)
*Automated testing and deployment*

### Transaction Export
![Transaction History with CSV Export](docs/transactions-screenshot.png)
*Filter by date, pool, or activity type — then export to CSV*

</div>

## Roadmap

### 🚀 Phase 1 - Foundation (Current)
- ✅ Core savings pool functionality (Rotational, Target, Flexible)
- ✅ Multi-wallet Stellar integration
- ✅ Factory contract for pool discovery
- ✅ Mobile-responsive web interface
- ✅ Real-time on-chain state synchronization
- ✅ Automated CI/CD pipeline

### 🔧 Phase 2 - Enhancement
- **DeFi Integration** – Connect flexible pools to Stellar DeFi protocols for yield
- **Mobile App** – Native iOS and Android applications
- **Advanced Analytics** – Detailed savings insights and projections
- **Group Communication** – In-app messaging and notifications
- **Reputation System** – Trust scores based on participation history

### 🌍 Phase 3 - Scale
- **Mainnet Deployment** – Production-ready contracts on Stellar mainnet
- **Fiat Integration** – Direct bank transfers and credit card support
- **Social Features** – Friend invitations and community building
- **Microloan Marketplace** – Borrow against savings with peer-to-peer lending
- **DAO Governance** – Community-driven protocol improvements

## Contributing

We welcome contributions from the community! Here's how you can help:

### Development
- 🐛 **Bug Reports** – Found an issue? [Open an issue](https://github.com/Sendi0011/Joint_Save/issues)
- 💡 **Feature Requests** – Have an idea? We'd love to hear it
- 🔧 **Code Contributions** – Submit pull requests for improvements
- 📖 **Documentation** – Help improve our docs and guides

### Testing
- 🧪 **Testnet Testing** – Try the app and report issues
- 📱 **Device Testing** – Test on different devices and browsers
- 🔍 **Security Review** – Help audit smart contracts and frontend code

### Community
- 💬 **Discussions** – Join conversations in GitHub Discussions
- 🌟 **Spread the Word** – Share JointSave with your network
- 🎓 **Education** – Help others learn about decentralized savings

## Documentation

- **[Architecture Guide](ARCHITECTURE.md)** – Detailed technical documentation
- **[Smart Contract API](smartcontract/README.md)** – Contract interfaces and usage
- **[Deployment Guide](smartcontract/scripts/deploy.sh)** – How to deploy contracts
- **[Frontend Setup](frontend/README.md)** – Development environment setup

## Security

Please refer to [SECURITY.md](SECURITY.md) for our security policy, in-scope components, known limitations, and instructions on how to report vulnerabilities.

## Support

- **Issues**: [GitHub Issues](https://github.com/Sendi0011/Joint_Save/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Sendi0011/Joint_Save/discussions)
- **Email**: [Contact the team](mailto:support@jointsave.app)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ for communities worldwide**

*Powered by [Stellar](https://stellar.org) • [Soroban](https://soroban.stellar.org) • [Next.js](https://nextjs.org)*

[Live Demo](https://joint-save.vercel.app) • [Watch Video](https://youtu.be/Iuy-As9im7A) • [View Code](https://github.com/Sendi0011/Joint_Save)

</div>
