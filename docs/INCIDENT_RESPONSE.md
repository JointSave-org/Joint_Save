# Incident Response Plan

This document outlines procedures for responding to security alerts detected by the JointSave monitoring system.

## Alert Severity Levels

| Level | Response Time | Action |
|-------|--------------|--------|
| **CRITICAL** | Immediate | Investigate within 15 minutes, notify affected users within 1 hour |
| **WARNING** | Within 4 hours | Investigate within 4 hours, document findings |
| **INFO** | Within 24 hours | Review during business hours, document if actionable |

## Response Procedures by Alert Type

### 1. Rapid Emergency Withdraw (CRITICAL)

**Trigger:** 3+ emergency withdrawals within 1 hour

**Steps:**
1. Immediately pause all affected pools
2. Identify the wallet(s) initiating emergency withdrawals
3. Review on-chain transaction history for the last 7 days
4. Check if the admin key may be compromised
5. Contact affected pool members
6. If compromise confirmed, rotate admin keys and restore from last known good state

**Escalation:** Notify the JointSave security team and affected pool creators immediately.

### 2. Unusual Deposit Spike (WARNING)

**Trigger:** Single deposit > 10x average deposit amount

**Steps:**
1. Verify the deposit transaction on-chain
2. Check if the wallet has history of large deposits
3. Confirm the pool's contribution schedule allows such deposits
4. If legitimate, mark as resolved; if suspicious, escalate to CRITICAL

### 3. Admin Key Rotation (INFO)

**Trigger:** Admin address changed for a pool

**Steps:**
1. Verify the rotation was authorized by the previous admin
2. Confirm the new admin address is a known, trusted party
3. Log the rotation in the audit trail
4. If unauthorized, immediately revert and secure the pool

### 4. Mass Member Removal (CRITICAL)

**Trigger:** Admin removes > 50% of members within 24 hours

**Steps:**
1. Immediately pause the affected pool(s)
2. Contact removed members to verify they did not request removal
3. Review admin action logs for the last 7 days
4. If the admin key is compromised, rotate keys and restore membership
5. Document all findings

### 5. Pool Pause Cascade (WARNING)

**Trigger:** > 5 pools paused within 1 hour

**Steps:**
1. Identify the admin(s) performing the pauses
2. Check if this is a coordinated, legitimate action
3. If unexpected, investigate for compromised admin credentials
4. Contact affected pool creators

### 6. Dormant Pool Activation (INFO)

**Trigger:** Pool inactive 90+ days receives large deposit

**Steps:**
1. Verify the deposit is from a legitimate pool member
2. Check if the pool's status should be updated (active vs. dormant)
3. Notify the pool creator of the activity
4. Update pool health metrics

### 7. Failed Transaction Storm (WARNING)

**Trigger:** > 10 failed transactions from same wallet in 5 minutes

**Steps:**
1. Check if the wallet is experiencing network issues
2. Review if the wallet is attempting unauthorized actions
3. If the wallet appears compromised, alert the user
4. Consider rate-limiting the wallet temporarily

### 8. Reputation Manipulation (WARNING)

**Trigger:** Same wallet creating pools with identical members repeatedly

**Steps:**
1. Review the pools created by the wallet
2. Check if the member overlap is legitimate (e.g., same savings group)
3. If manipulation is confirmed, flag the wallet for review
4. Consider adding the wallet to a watchlist

## Escalation Matrix

| Severity | First Responder | Escalation |
|----------|----------------|------------|
| CRITICAL | On-call security lead | JointSave core team + affected users |
| WARNING | Pool admin | Security lead |
| INFO | Pool admin | Review during standup |

## Communication Templates

### CRITICAL Alert - Affected Users

> Subject: Security Alert - Immediate Action Required
>
> We detected suspicious activity on your pool [POOL_NAME]. Emergency withdrawals were detected that may indicate unauthorized access.
>
> **What happened:** [DESCRIPTION]
> **What we're doing:** The pool has been paused and we are investigating.
> **What you should do:** [ACTION_ITEMS]
>
> We will provide updates as our investigation progresses.

### CRITICAL Alert - Internal

> Subject: [SEVERITY] Security Alert - [RULE_NAME]
>
> **Alert:** [RULE_NAME]
> **Affected Pools:** [POOL_IDS]
> **Affected Wallets:** [WALLET_ADDRESSES]
> **Detection Time:** [TIMESTAMP]
>
> Please investigate immediately and update the alert status.

## Review and Post-Incident

After resolving any CRITICAL or WARNING alert:
1. Document the root cause
2. Update this document if new procedures are needed
3. Add any new detection rules if the incident was not caught
4. Conduct a post-incident review within 48 hours
