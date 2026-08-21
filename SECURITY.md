# Security Policy

## Scope

The following components are **in-scope** for security vulnerability reports:

- **Smart Contracts** (Soroban smart contracts in the `smartcontract` directory)
- **Frontend** (Next.js application in the `frontend` directory)
- **API Routes** (Any backend or API routes defined within the frontend project)

The following components are **out-of-scope**:

- **Third-party wallets** (e.g., Freighter, xBull, Albedo, Lobstr)
- **Stellar network** infrastructure and core protocols

## Reporting a Vulnerability

If you discover a security vulnerability, please do **not** open a public issue. Instead, report it privately:

- **Contact Email:** [security@jointsave.app](mailto:security@jointsave.app)
- **Expected Response Time:** Within 72 hours for initial acknowledgment and triage.

### What to Include in Your Report

Please include the following information to help us understand and resolve the issue quickly:

1. **Description:** A detailed explanation of the vulnerability and its potential impact.
2. **Steps to Reproduce:** Clear, step-by-step instructions (or a proof-of-concept script/exploit) to replicate the issue.
3. **Affected Components:** The specific smart contracts, frontend pages, or API routes affected.
4. **Remediation Suggestion:** Any suggestions or proposed fixes, if available.

## Disclosure Policy

We follow a responsible disclosure policy:

- **Fix Window:** We request a 90-day window from the time of the initial report to resolve the vulnerability before any public disclosure is made.
- **Coordinated Disclosure:** We will work with you to coordinate public disclosure of the vulnerability after a patch has been released.

## Known Limitations

Please note the following current limitations of the system:

- **No Formal Audit:** The smart contracts and frontend application have not undergone a formal security audit.
- **Testnet-Only Status:** The project is currently deployed on the Stellar Testnet only and should not be used with real mainnet assets.

## Audit Status

- _No audits have been conducted yet. This section will be updated with links to official reports once a formal audit is completed._
