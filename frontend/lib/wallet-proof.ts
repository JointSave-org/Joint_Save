/**
 * SEP-53 Wallet Signature Proof
 * 
 * Client-side utilities for signing messages with user's wallet to prove ownership.
 * Used for admin actions (pause, unpause, emergency_withdraw) to prevent spoofing.
 */

import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit'

export interface WalletProofMessage {
  action: 'pause' | 'unpause' | 'emergency_withdraw'
  poolId: string
  poolAddress: string
  adminAddress: string
  timestamp: number
  reason?: string
  recipient?: string
}

export interface SignedWalletProof {
  message: WalletProofMessage
  signature: string
  publicKey: string
}

/**
 * Generate a deterministic message string from the proof message
 */
export function generateProofMessage(msg: WalletProofMessage): string {
  const parts = [
    `JointSave Admin Action`,
    `Action: ${msg.action}`,
    `Pool: ${msg.poolId}`,
    `Contract: ${msg.poolAddress}`,
    `Admin: ${msg.adminAddress}`,
    `Timestamp: ${msg.timestamp}`,
  ]
  
  if (msg.reason) {
    parts.push(`Reason: ${msg.reason}`)
  }
  
  if (msg.recipient) {
    parts.push(`Recipient: ${msg.recipient}`)
  }
  
  return parts.join('\n')
}

/**
 * Sign a wallet proof message using the connected wallet
 */
export async function signWalletProof(
  kit: StellarWalletsKit,
  message: WalletProofMessage
): Promise<SignedWalletProof> {
  const messageStr = generateProofMessage(message)
  
  try {
    const { signedMessage, signerAddress } = await kit.signMessage(messageStr)
    
    if (!signedMessage || !signerAddress) {
      throw new Error('Failed to sign message')
    }
    
    // Verify the signer matches the admin address
    if (signerAddress.toLowerCase() !== message.adminAddress.toLowerCase()) {
      throw new Error('Signer address does not match admin address')
    }
    
    return {
      message,
      signature: signedMessage,
      publicKey: signerAddress,
    }
  } catch (error) {
    console.error('Wallet proof signing error:', error)
    throw new Error(`Failed to sign wallet proof: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Create a timestamp for the proof (current time in seconds)
 */
export function createProofTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Check if a timestamp is still valid (within 5 minutes)
 */
export function isTimestampValid(timestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  const fiveMinutes = 5 * 60
  return Math.abs(now - timestamp) <= fiveMinutes
}

/**
 * Generate the message for revoking a pause authorization
 */
export function revokePauseAuthorizationMessage(
  authorizationId: string,
  signedAt: number
): string {
  return [
    `JointSave Revoke Pause Authorization`,
    `Authorization ID: ${authorizationId}`,
    `Signed At: ${signedAt}`,
  ].join('\n')
}
