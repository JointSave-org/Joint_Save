/**
 * Re-export the shared mock implementations from @/__mocks__/useJointSaveContracts
 *
 * This file allows Vitest's module resolution to find the mock when tests call:
 * vi.mock("@/hooks/useJointSaveContracts")
 *
 * Without this re-export, explicit vi.mock() calls in tests would create an
 * auto-mock instead of using our custom implementations.
 */
export * from "../../__mocks__/useJointSaveContracts"
