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

## Automated response (circuit breaker)

The procedures above are what a human does. This section covers what the system
does on its own, before anyone reads the alert.

When a security scan (`/api/cron/security-scan` or `/api/admin/security/scan`)
raises enough CRITICAL alerts against a single pool, the circuit breaker pauses
that pool so no further money moves until an admin has looked at it. Every
decision it takes, including the ones it decides against, is recorded in the
`incidents` table and surfaced in the admin audit log.

### What "auto-pause" means, and what it cannot do

The pause has two halves, and only the first can be automatic.

| Half | Automatic? | Effect |
|------|-----------|--------|
| Platform pause | Yes | `pools.status` becomes `paused` with a reason and timestamp. The app stops offering deposits and payouts immediately. Reversible from the admin endpoint. |
| On-chain pause | Yes, when pre-authorised | Submitted by the platform using an authorization the admin signed in advance. Without one, the admin signs `rotational::pause` themselves. |

The contract asserts `admin.require_auth()` and that the caller equals the pool's
stored admin, which is the creator's wallet. The platform holds no key that
satisfies it today: `SPONSOR_SECRET_KEY` only pays network fees, and a fee bump
authorises nothing inside the transaction. So an executed incident is recorded
with `onchain_status = 'pending'` and the admin signs the contract call from the
review screen, after which the hash is recorded against the incident.

That is a key-custody gap rather than a contract limitation, and it is closed
with **pre-signed authorization entries**, with no contract change.

### How the automatic on-chain pause works

A `SorobanAuthorizationEntry` is signed independently of the transaction
envelope, so the party who authorises a call and the party who submits it can be
different. The admin signs one entry covering exactly `pause(admin)` on exactly
their pool's contract. The platform stores it and, when the breaker trips, wraps
it in a transaction it pays for and signs the envelope of.

Two signatures, two jobs: the admin authorises the call, the platform authorises
the fee. The platform never holds the admin's key, and the credential it does
hold can do one thing.

```
admin's wallet                     platform
     |                                |
     |  signs pause(admin) entry      |
     |------------------------------->|  stored, single use, expires
     |                                |
                                      |  breaker trips
                                      |  wraps entry in a tx, pays the fee
                                      |------------------> Soroban
```

An alternative exists and was deliberately not taken: `require_auth` for a
classic `G` address uses Stellar multisig at the medium threshold, so an admin
could add a platform signer with enough weight instead. That is simpler to
operate but a far wider grant, since the weight applies to the account in
general rather than to one call.

### Authorising it

```
GET  /api/admin/pause-authorizations?poolId=<id>&callerAddress=<address>
POST /api/admin/pause-authorizations   { admin_address, pool_id, entry_xdr }
POST /api/admin/pause-authorizations   { action: "revoke", id, signature, signed_at }
```

`lib/pause-authorization.ts` builds and signs the entry in the browser through
the wallet kit. The server validates what actually arrived rather than trusting
the client: the entry must be address-credentialed, invoke `pause`, take the
signer as its only argument, and carry no sub-invocations, so it cannot smuggle a
second call. It is also matched against the pool's contract and admin, and
refused if it expires too soon to be useful.

The entry XDR is never returned by `GET`, and the table has no read policy for
anyone but the service role. It is a bearer credential: whoever holds it can
pause the pool, which would be a griefing vector against the pool's own members.

### Revoking needs a signature, not an address

Registering an authorization is self-validating: an entry that was not signed by
the pool real admin is refused by the inspector no matter who posted it, and the
contract would reject it anyway. Revoking is different, because revoking disarms
the automatic pause. An attacker preparing to drain a pool could otherwise switch
off the defence using only public data, since a pool id and its creator address
are both readable.

So revocation asks the wallet to sign a short, timestamped message naming the
exact authorization, and the server verifies it under SEP-53 against the pool
admin as recorded, not against any address in the request. A captured proof stops
working within minutes and does not transfer to another authorization.
`lib/pause-authorization.ts` has the client side, `lib/server/wallet-proof.ts`
the verification.

### What happens when there is no authorization

The platform pause still happens, immediately. The incident is recorded with
`onchain_status = 'pending'`, the admin is told why in their notification, and
they sign the contract call themselves from the review screen. The pool is
protected either way; pre-authorising only removes the wait.

Entries are single-use and expire, so an admin who wants the automatic pause to
keep working re-signs one occasionally. `GET` reports `armed: true` while a
usable one exists.

### emergency_withdraw is never automatic

Nothing in the automated path can move funds. The breaker's action type has
exactly two values, `pause` and `none`, and a unit test asserts that set has not
grown. `emergency_withdraw` stays a manual, admin-only contract call.

### Thresholds and cooldown

| Setting | Default | What it does |
|---------|---------|--------------|
| `INCIDENT_AUTO_PAUSE_ENABLED` | unset (dry-run) | Arms the breaker. Only the exact string `true` arms it. |
| `INCIDENT_CRITICAL_THRESHOLD` | 2 | Critical alerts against one pool needed to trip it. |
| `INCIDENT_THRESHOLD_WINDOW_MS` | 3600000 (1h) | How far back alerts count towards the threshold. |
| `INCIDENT_MAX_PAUSES_PER_WINDOW` | 1 | Auto-pauses allowed per pool inside the cooldown window. |
| `INCIDENT_COOLDOWN_WINDOW_MS` | 86400000 (24h) | The cooldown window. |

The cooldown is what prevents pause-flap. With the defaults, a pool is
auto-paused at most once a day; if it trips again it stays paused and waits for
an admin instead of oscillating. The gate is checked before the action, so a
pool in cooldown is never paused and then reverted. Only pauses that actually
happened count towards it, so a dry-run period does not silently consume a
pool's allowance.

### Rolling it out with dry-run

Dry-run is the default and is the intended rollout mechanism, not a switch to
skip past. In dry-run the breaker still decides, still writes the incident and
still notifies the admin. It just does not pause anything.

Both scan endpoints report `incidentResponse`, which always answers whether an
action *would* have fired, independently of dry-run:

```jsonc
{
  "incidentResponse": {
    "dryRun": true,
    "wouldFire": 2,        // pools that met the thresholds
    "paused": 0,           // pools actually paused
    "cooldownBlocked": 1,  // held back by the cooldown
    "decisions": [ /* one per pool, with the reason */ ],
    "incidentIds": ["..."]
  }
}
```

Run it that way for a while, read the incidents it would have created, and only
then set `INCIDENT_AUTO_PAUSE_ENABLED=true`.

### Admin review and recovery

```
GET  /api/admin/incidents?poolId=<id>&callerAddress=<address>
POST /api/admin/incidents/<incidentId>
```

The POST body takes `admin_address` and an `action`:

| Action | What it does |
|--------|--------------|
| `resolve` | Closes the incident with a required note. The pool stays paused. |
| `resume` | Closes it and returns the pool to `active`. |
| `record_onchain` | Attaches the hash of the `pause` or `unpause` transaction the admin signed. |

Both endpoints verify the caller against the pool's `creator_address`
server-side, the same check `/api/admin/audit-log` uses.

`resume` lifts the platform pause only. If the admin had already signed an
on-chain pause, the response returns `onchainUnpauseRequired: true` and the
contract stays paused until they sign `unpause` themselves.

### Where to look

| Piece | File |
|-------|------|
| Decision logic (pure, unit tested) | `frontend/lib/incident-response.ts` |
| Tests | `frontend/lib/incident-response.test.ts` |
| Execution against Supabase | `frontend/lib/server/incident-actions.ts` |
| Admin review and recovery | `frontend/app/api/admin/incidents/` |
| On-chain pause submission | `frontend/lib/server/pause-onchain.ts` |
| Signing an authorization (browser) | `frontend/lib/pause-authorization.ts` |
| Authorization endpoints | `frontend/app/api/admin/pause-authorizations/` |
| Schema | `supabase/migrations/20260827120000_incident_response.sql` |
| Authorization schema | `supabase/migrations/20260827130000_pause_authorizations.sql` |

## Review and Post-Incident

After resolving any CRITICAL or WARNING alert:
1. Document the root cause
2. Update this document if new procedures are needed
3. Add any new detection rules if the incident was not caught
4. Conduct a post-incident review within 48 hours
