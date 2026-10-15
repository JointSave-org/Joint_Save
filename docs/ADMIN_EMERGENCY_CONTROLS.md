# Admin Emergency Controls - Implementation Guide

## Overview

This document describes the implementation of admin self-service emergency controls with SEP-53 signature proof for JointSave pools (Issue #263).

## Features

### 1. Manual Pause/Resume

Admins can manually pause and resume pools from the UI:

- **Pause**: Halts all deposits and payouts, requires a reason
- **Resume**: Restores normal pool operations
- Both actions require wallet signature proof
- Actions are logged in the pool activity feed

### 2. Emergency Withdrawal

Admins can trigger emergency withdrawal in case of critical contract malfunction:

- Transfers ALL pool funds to a specified recipient
- Marks the pool as inactive permanently
- **IRREVERSIBLE** - includes multiple confirmation steps
- Requires wallet signature proof

### 3. SEP-53 Signature Proof

All admin actions require cryptographic proof of wallet ownership:

- Admin wallet signs a timestamped message
- Server verifies signature against pool creator address
- Prevents address spoofing in request bodies
- Timestamps expire after 5 minutes

## Architecture

### Smart Contract Layer

**File**: `smartcontract/contracts/rotational/src/lib.rs`

Added three admin functions to the rotational pool contract:

```rust
pub fn pause(env: Env, admin: Address)
pub fn unpause(env: Env, admin: Address)
pub fn emergency_withdraw(env: Env, admin: Address, recipient: Address)
```

**Key Features**:
- Admin authorization check via `require_auth()`
- Stores admin address during initialization
- Pause flag prevents deposits and payouts
- Emergency withdraw transfers full balance

**Storage Keys**:
- `Admin`: Stores the admin/creator address
- `Paused`: Boolean flag for pause state

**View Functions**:
- `is_paused()`: Check if pool is paused
- `admin()`: Get admin address

### Frontend Client Layer

**Files**:
- `frontend/lib/wallet-proof.ts`: Client-side signing utilities
- `frontend/components/group/admin-emergency-controls.tsx`: UI component

**Wallet Proof Flow**:

1. User initiates action (pause/unpause/emergency_withdraw)
2. Create proof message with:
   - Action type
   - Pool ID and contract address
   - Admin address
   - Timestamp (current time in seconds)
   - Optional: reason or recipient
3. Generate deterministic message string
4. Sign with user's wallet via `kit.signMessage()`
5. Submit proof to API endpoint

**UI Components**:
- Alert banner showing pool status (paused/active)
- Admin controls card (only visible to pool creator)
- Confirmation dialogs for each action
- Input forms for reason (pause) and recipient (emergency withdraw)

### Backend API Layer

**File**: `frontend/app/api/pools/[id]/admin/route.ts`

**Endpoints**:
- `POST /api/pools/[id]/admin` - Handle all admin actions

**Request Body**:
```typescript
{
  action: 'pause' | 'unpause' | 'emergency_withdraw',
  proof: {
    message: WalletProofMessage,
    signature: string,
    publicKey: string
  },
  reason?: string,      // for pause
  recipient?: string    // for emergency_withdraw
}
```

**Validation Steps**:

1. Verify proof structure is complete
2. Fetch pool from database
3. Verify signature against pool creator address
4. Check rate limiting (5 actions per minute)
5. Validate pool eligibility for action
6. Execute action (update DB, call contract)
7. Log activity

**Security**:
- Rate limiting per pool per admin
- Ownership verification via `checkWalletProof()`
- Timestamp expiration (5 minutes)
- Action-specific eligibility checks

### Server-Side Verification

**File**: `frontend/lib/server/wallet-proof.ts`

**Functions**:

```typescript
verifySignedMessage(
  message: WalletProofMessage,
  signature: string,
  expectedPublicKey: string
): VerificationResult

checkWalletProof(
  proof: SignedWalletProof,
  poolCreatorAddress: string
): VerificationResult
```

**Verification Steps**:

1. Validate timestamp (within 5 minutes)
2. Check admin address matches signer
3. Recreate exact signed message
4. Verify cryptographic signature
5. Confirm signer is pool creator

## Database Schema

### Migrations

**File**: `frontend/lib/supabase-migrations.sql`

Added columns to `pools` table:

```sql
ALTER TABLE pools ADD COLUMN pause_reason TEXT;
ALTER TABLE pools ADD COLUMN paused_at TIMESTAMP;
```

### Pool Activity Types

New activity types logged:
- `admin_pause`
- `admin_unpause`
- `admin_emergency_withdraw`

## Internationalization

**File**: `frontend/lib/i18n/admin-controls.ts`

Supports English (EN) and Spanish (ES) with strings for:
- Alert messages
- Button labels
- Dialog titles and descriptions
- Form labels and placeholders
- Success/error messages
- Warnings

## Security Considerations

### Safeguards

1. **Wallet Signature Required**: All actions require proof of wallet ownership
2. **Rate Limiting**: Max 5 actions per pool per admin per minute
3. **Timestamp Expiration**: Signatures valid for 5 minutes only
4. **Ownership Verification**: Only pool creator can execute admin actions
5. **Eligibility Checks**: Actions only allowed when pool is in valid state
6. **Audit Logging**: All actions recorded in `pool_activity` table
7. **Irreversible Action Warnings**: Multiple confirmations for emergency withdraw

### Attack Prevention

- **Address Spoofing**: Prevented by signature verification
- **Replay Attacks**: Prevented by timestamp expiration
- **Rate Limiting**: Prevents abuse
- **Unauthorized Access**: Only creator can perform actions

## Testing

### Unit Tests

**File**: `frontend/__tests__/wallet-proof.test.ts`

Tests cover:
- Message generation (deterministic output)
- Timestamp creation and validation
- Signature verification logic
- Ownership checks
- Integration scenarios

### Manual Testing Checklist

- [ ] Connect wallet as pool creator
- [ ] Verify admin controls visible
- [ ] Pause pool with reason
- [ ] Verify deposits blocked when paused
- [ ] Unpause pool
- [ ] Verify deposits resume
- [ ] Test emergency withdraw dialog
- [ ] Verify warnings displayed
- [ ] Confirm funds transferred correctly
- [ ] Check activity log entries
- [ ] Test with non-admin user (controls should not show)
- [ ] Test rate limiting (5 actions rapidly)
- [ ] Test expired timestamp rejection

## Usage Guide

### For Pool Admins

**Pausing a Pool**:

1. Navigate to your pool's group page
2. Locate the "Admin Emergency Controls" card
3. Click "Pause Pool"
4. Enter a clear reason for pausing
5. Sign the message in your wallet
6. Confirm the action

**Resuming a Pool**:

1. Navigate to paused pool's group page
2. Click "Resume Pool" in the admin controls
3. Sign the message in your wallet
4. Confirm the action

**Emergency Withdrawal** (⚠️ LAST RESORT):

1. Only use if contract is malfunctioning
2. Navigate to pool's group page
3. Click "Emergency Withdraw"
4. **Read all warnings carefully**
5. Enter recipient Stellar address
6. Sign the message in your wallet
7. Confirm the irreversible action

### For Developers

**Adding Admin Actions**:

1. Add contract function in `smartcontract/contracts/rotational/src/lib.rs`
2. Add action type to `WalletProofMessage` in `frontend/lib/wallet-proof.ts`
3. Add handler in admin API route
4. Add UI in `admin-emergency-controls.tsx`
5. Add i18n strings
6. Add tests

## Future Enhancements

### Phase 1 (Current Implementation)
- ✅ Manual pause/resume with reason
- ✅ Emergency withdrawal
- ✅ SEP-53 signature proof
- ✅ Rate limiting
- ✅ Audit logging
- ✅ EN + ES localization

### Phase 2 (Planned)
- [ ] On-chain contract calls (currently DB-only)
- [ ] Multi-signature support for large pools
- [ ] Time-locked pause (auto-resume after duration)
- [ ] Partial emergency withdrawals
- [ ] Admin action history dashboard
- [ ] Email/SMS notifications for admin actions

### Phase 3 (Future)
- [ ] Governance voting for admin actions
- [ ] Delegated admin roles
- [ ] Advanced circuit breaker rules
- [ ] Automated pause triggers
- [ ] Insurance fund integration

## Contract Deployment

When deploying updated contracts with pause/unpause/emergency_withdraw:

1. Build contracts: `stellar contract build`
2. Deploy to testnet: `./scripts/deploy.sh`
3. Initialize pools with admin address
4. Update frontend with new WASM hashes
5. Test all admin functions on-chain
6. Update API to call on-chain functions
7. Deploy to production

## References

- Issue: #263
- PR: (Will be added after merge)
- SEP-53: https://stellar.org/protocol/sep-53
- Stellar SDK: https://github.com/stellar/js-stellar-sdk
- Soroban Docs: https://soroban.stellar.org

## Support

For questions or issues:
- GitHub Issues: https://github.com/JointSave-org/Joint_Save/issues
- Discussions: https://github.com/JointSave-org/Joint_Save/discussions

## License

MIT License - See LICENSE file for details
