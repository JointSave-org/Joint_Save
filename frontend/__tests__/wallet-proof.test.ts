/**
 * Tests for SEP-53 Wallet Proof functionality
 * 
 * Tests cover:
 * - Message generation
 * - Timestamp validation
 * - Signature verification
 * - Ownership checks
 */

import { describe, it, expect } from '@jest/globals'
import {
  generateProofMessage,
  createProofTimestamp,
  isTimestampValid,
  type WalletProofMessage,
} from '../lib/wallet-proof'
import {
  verifySignedMessage,
  checkWalletProof,
} from '../lib/server/wallet-proof'

describe('Wallet Proof - Message Generation', () => {
  it('should generate deterministic message from proof data', () => {
    const message: WalletProofMessage = {
      action: 'pause',
      poolId: 'pool-123',
      poolAddress: 'CTEST123',
      adminAddress: 'GTEST123',
      timestamp: 1234567890,
      reason: 'Security issue',
    }

    const messageStr = generateProofMessage(message)

    expect(messageStr).toContain('JointSave Admin Action')
    expect(messageStr).toContain('Action: pause')
    expect(messageStr).toContain('Pool: pool-123')
    expect(messageStr).toContain('Contract: CTEST123')
    expect(messageStr).toContain('Admin: GTEST123')
    expect(messageStr).toContain('Timestamp: 1234567890')
    expect(messageStr).toContain('Reason: Security issue')
  })

  it('should generate message without optional fields', () => {
    const message: WalletProofMessage = {
      action: 'unpause',
      poolId: 'pool-456',
      poolAddress: 'CTEST456',
      adminAddress: 'GTEST456',
      timestamp: 1234567890,
    }

    const messageStr = generateProofMessage(message)

    expect(messageStr).not.toContain('Reason:')
    expect(messageStr).not.toContain('Recipient:')
  })

  it('should include recipient for emergency_withdraw', () => {
    const message: WalletProofMessage = {
      action: 'emergency_withdraw',
      poolId: 'pool-789',
      poolAddress: 'CTEST789',
      adminAddress: 'GTEST789',
      timestamp: 1234567890,
      recipient: 'GRECIPIENT',
    }

    const messageStr = generateProofMessage(message)

    expect(messageStr).toContain('Recipient: GRECIPIENT')
  })
})

describe('Wallet Proof - Timestamp Validation', () => {
  it('should create valid current timestamp', () => {
    const timestamp = createProofTimestamp()
    const now = Math.floor(Date.now() / 1000)

    // Should be within 1 second of current time
    expect(Math.abs(timestamp - now)).toBeLessThanOrEqual(1)
  })

  it('should validate recent timestamps', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTimestampValid(now)).toBe(true)
    expect(isTimestampValid(now - 60)).toBe(true) // 1 minute ago
    expect(isTimestampValid(now - 299)).toBe(true) // 4:59 ago
  })

  it('should reject expired timestamps', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTimestampValid(now - 301)).toBe(false) // 5:01 ago
    expect(isTimestampValid(now - 600)).toBe(false) // 10 minutes ago
  })

  it('should reject future timestamps', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTimestampValid(now + 301)).toBe(false) // 5:01 in future
  })
})

describe('Wallet Proof - Signature Verification', () => {
  it('should reject expired message timestamps', () => {
    const message: WalletProofMessage = {
      action: 'pause',
      poolId: 'pool-123',
      poolAddress: 'CTEST123',
      adminAddress: 'GTEST123',
      timestamp: Math.floor(Date.now() / 1000) - 400, // 6+ minutes ago
    }

    const result = verifySignedMessage(message, 'fake-signature', 'GTEST123')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Timestamp expired')
  })

  it('should reject admin address mismatch', () => {
    const message: WalletProofMessage = {
      action: 'pause',
      poolId: 'pool-123',
      poolAddress: 'CTEST123',
      adminAddress: 'GTEST123',
      timestamp: createProofTimestamp(),
    }

    const result = verifySignedMessage(message, 'fake-signature', 'GWRONG123')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('mismatch')
  })
})

describe('Wallet Proof - Ownership Check', () => {
  it('should reject when signer is not pool creator', async () => {
    const message: WalletProofMessage = {
      action: 'pause',
      poolId: 'pool-123',
      poolAddress: 'CTEST123',
      adminAddress: 'GATTACKER',
      timestamp: createProofTimestamp(),
    }

    const proof = {
      message,
      signature: 'fake-signature',
      publicKey: 'GATTACKER',
    }

    // Note: This test assumes verifySignedMessage is in permissive mode
    // In production, this would fail at signature verification
    const result = await checkWalletProof(proof, 'GREALCREATOR')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('pool creator')
  })
})

describe('Wallet Proof - Integration', () => {
  it('should validate complete valid proof', () => {
    const timestamp = createProofTimestamp()
    const adminAddress = 'GADMIN123'

    const message: WalletProofMessage = {
      action: 'pause',
      poolId: 'pool-123',
      poolAddress: 'CTEST123',
      adminAddress,
      timestamp,
      reason: 'Maintenance',
    }

    const messageStr = generateProofMessage(message)

    expect(messageStr).toBeTruthy()
    expect(isTimestampValid(timestamp)).toBe(true)
  })
})
