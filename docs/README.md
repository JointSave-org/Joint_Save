# JointSave Documentation

Start with the [project README](../README.md), then pick the guide that matches
what you are building.

## SDK and integrations

- [SDK integration guide](sdk.md) — architecture, signer contract, network
  switching, error taxonomy, testing, security, and frontend parity
- [SDK README](../sdk/README.md) — install, quick start, API groups, versioning
- [SDK changelog](../sdk/CHANGELOG.md) — releases and deprecations
- [HTTP API guide](api/README.md) — versioning, pagination, errors, experimental
  routes
- [OpenAPI 3.1 contract](api/openapi.json) — machine-readable read models

## Contracts

- [Smart contract API reference](contract-api.md) — functions, events, storage,
  and error conditions
- [Yield allocation threat model](security/yield-allocation-threat-model.md) —
  risks and mitigations for vault-backed yield
- [Transaction simulation plan](TX_SIMULATION_PLAN.md) — simulation strategy
- [Pool archival](pool-archival.md) — lifecycle and cleanup rules

## Operations and security

- [Incident response](INCIDENT_RESPONSE.md)
- [API rate limits](api-rate-limits.md)
- [RLS access model](security/rls-policies.md)
- [Security policy](../SECURITY.md)

## Architecture and planning

- [Architecture guide](../ARCHITECTURE.md)
- [Storage TTL management plan](plans/2026-06-21-storage-ttl-management.md)
- [Yield allocation plan](plans/2026-10-16-yield-allocation.md)
- [Contributing guide](../CONTRIBUTING.md)
