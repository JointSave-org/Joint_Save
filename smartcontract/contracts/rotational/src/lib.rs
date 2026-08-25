#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec, Symbol, BytesN, symbol_short,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const PENDING_ACTION_EXPIRY: u64 = 48 * 3600; // 48 hours in seconds

#[contracttype]
#[derive(Clone)]
pub struct PendingAction {
    pub approvers: Vec<Address>,
    pub created_at: u64,
}

#[contracttype]
pub enum DataKey {
    Token,
    Admin,
    Treasury,
    Members,
    DepositAmount,
    RoundDuration,
    TreasuryFeeBps,
    RelayerFeeBps,
    CurrentRound,
    NextPayoutTime,
    Active,
    Paused,
    HasDeposited(Address),
    AdminQuorum,
    PendingAction(BytesN<32>),
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct RotationalPool;

#[contractimpl]
impl RotationalPool {
    /// Initialize the rotational savings pool.
    pub fn initialize(
        env: Env,
        token: Address,
        admin: Address,
        members: Vec<Address>,
        deposit_amount: i128,
        round_duration: u64,
        treasury_fee_bps: u32,
        relayer_fee_bps: u32,
        treasury: Address,
    ) {
        assert!(members.len() >= 2, "need >=2 members");
        assert!(deposit_amount > 0, "deposit must be > 0");
        assert!(round_duration > 0, "round_duration must be > 0");

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Treasury, &treasury);
        storage.set(&DataKey::Members, &members);
        storage.set(&DataKey::DepositAmount, &deposit_amount);
        storage.set(&DataKey::RoundDuration, &round_duration);
        storage.set(&DataKey::TreasuryFeeBps, &treasury_fee_bps);
        storage.set(&DataKey::RelayerFeeBps, &relayer_fee_bps);
        storage.set(&DataKey::CurrentRound, &0u32);
        storage.set(
            &DataKey::NextPayoutTime,
            &(env.ledger().timestamp() + round_duration),
        );
        storage.set(&DataKey::Active, &true);
        storage.set(&DataKey::Paused, &false);
    }

    /// Member deposits their fixed contribution for the current round.
    pub fn deposit(env: Env, member: Address) {
        member.require_auth();

        let storage = env.storage().persistent();
        let active: bool = storage.get(&DataKey::Active).unwrap();
        assert!(active, "pool inactive");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");

        let already: bool = storage
            .get(&DataKey::HasDeposited(member.clone()))
            .unwrap_or(false);
        assert!(!already, "already deposited this round");

        let deposit_amount: i128 = storage.get(&DataKey::DepositAmount).unwrap();
        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&member, &env.current_contract_address(), &deposit_amount);

        storage.set(&DataKey::HasDeposited(member.clone()), &true);
        env.events().publish(
            (symbol_short!("deposit"), member),
            deposit_amount,
        );
    }

    /// Trigger payout for the current round. Caller receives the relayer fee.
    pub fn trigger_payout(env: Env, relayer: Address) {
        relayer.require_auth();

        let storage = env.storage().persistent();
        let active: bool = storage.get(&DataKey::Active).unwrap();
        assert!(active, "pool inactive");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let next_payout_time: u64 = storage.get(&DataKey::NextPayoutTime).unwrap();
        assert!(
            env.ledger().timestamp() >= next_payout_time,
            "too early"
        );

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        let deposit_amount: i128 = storage.get(&DataKey::DepositAmount).unwrap();
        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let treasury: Address = storage.get(&DataKey::Treasury).unwrap();
        let treasury_fee_bps: u32 = storage.get(&DataKey::TreasuryFeeBps).unwrap();
        let relayer_fee_bps: u32 = storage.get(&DataKey::RelayerFeeBps).unwrap();
        let current_round: u32 = storage.get(&DataKey::CurrentRound).unwrap();
        let round_duration: u64 = storage.get(&DataKey::RoundDuration).unwrap();

        let token_client = token::Client::new(&env, &token_addr);

        // Count deposits
        let mut deposit_count: i128 = 0;
        for m in members.iter() {
            if storage
                .get::<DataKey, bool>(&DataKey::HasDeposited(m.clone()))
                .unwrap_or(false)
            {
                deposit_count += 1;
            }
        }
        assert!(deposit_count > 0, "no deposits this round");

        let total_collected = deposit_amount * deposit_count;
        let treasury_cut = (total_collected * treasury_fee_bps as i128) / 10000;
        let relayer_cut = (total_collected * relayer_fee_bps as i128) / 10000;
        let payout_amount = total_collected - treasury_cut - relayer_cut;

        let beneficiary = members.get(current_round).unwrap();

        if treasury_cut > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &treasury_cut);
        }
        if relayer_cut > 0 {
            token_client.transfer(&env.current_contract_address(), &relayer, &relayer_cut);
        }
        token_client.transfer(&env.current_contract_address(), &beneficiary, &payout_amount);

        env.events().publish(
            (symbol_short!("payout"), beneficiary.clone()),
            payout_amount,
        );

        // Reset deposits for next round
        for m in members.iter() {
            storage.remove(&DataKey::HasDeposited(m.clone()));
        }

        let next_round = current_round + 1;
        if next_round >= members.len() {
            storage.set(&DataKey::Active, &false);
            env.events()
                .publish((symbol_short!("complete"),), Symbol::new(&env, "pool_done"));
        } else {
            storage.set(&DataKey::CurrentRound, &next_round);
            storage.set(
                &DataKey::NextPayoutTime,
                &(env.ledger().timestamp() + round_duration),
            );
        }
    }

    // ── Emergency controls ─────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        // If quorum is configured, pause must go through multi-sig
        let quorum: Vec<Address> = storage
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env));
        assert!(quorum.len() == 0, "multi-sig enabled; use approve_action + execute_approved");
        storage.set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), ());
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        let quorum: Vec<Address> = storage
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env));
        assert!(quorum.len() == 0, "multi-sig enabled; use approve_action + execute_approved");
        storage.set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    pub fn emergency_withdraw(env: Env, admin: Address, recipient: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        let quorum: Vec<Address> = storage
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env));
        assert!(quorum.len() == 0, "multi-sig enabled; use approve_action + execute_approved");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(paused, "pool not paused");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let contract_balance = token_client.balance(&env.current_contract_address());

        if contract_balance > 0 {
            token_client.transfer(&env.current_contract_address(), &recipient, &contract_balance);
        }

        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
    }

    /// Remove a member from the pool (single-sig fallback; rejected if quorum is configured).
    pub fn remove_member(env: Env, admin: Address, member: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        let quorum: Vec<Address> = storage
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env));
        assert!(quorum.len() == 0, "multi-sig enabled; use approve_action + execute_approved");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        let mut new_members = Vec::new(&env);
        let mut found = false;
        for m in members.iter() {
            if m == member {
                found = true;
            } else {
                new_members.push_back(m);
            }
        }
        assert!(found, "member not found");
        assert!(new_members.len() >= 1, "must have at least 1 member");
        storage.set(&DataKey::Members, &new_members);
        env.events()
            .publish((symbol_short!("mem_rm"), member), ());
    }

    // ── Multi-sig admin controls ──────────────────────────────────────────

    /// Set the admin quorum. Only callable by the current single admin.
    /// When quorum has >=1 members, high-risk actions require multi-sig approval.
    pub fn set_admin_quorum(env: Env, admin: Address, new_admins: Vec<Address>) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        assert!(new_admins.len() >= 2, "quorum must have at least 2 admins");
        // The original admin must be in the quorum
        let mut found = false;
        for a in new_admins.iter() {
            if a == stored_admin {
                found = true;
                break;
            }
        }
        assert!(found, "original admin must be in quorum");
        storage.set(&DataKey::AdminQuorum, &new_admins);
        env.events()
            .publish((symbol_short!("qrm_set"),), new_admins.len() as u32);
    }

    /// Record an admin's approval for a proposed action.
    pub fn approve_action(env: Env, admin: Address, action_hash: BytesN<32>) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let quorum: Vec<Address> = storage
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env));
        assert!(quorum.len() > 0, "no quorum configured");
        assert!(Self::is_quorum_member(&quorum, &admin), "not a quorum admin");

        let mut pending = storage
            .get(&DataKey::PendingAction(action_hash.clone()))
            .unwrap_or(PendingAction {
                approvers: Vec::new(&env),
                created_at: env.ledger().timestamp(),
            });

        // Don't double-count
        for a in pending.approvers.iter() {
            assert!(a != admin, "already approved");
        }

        pending.approvers.push_back(admin.clone());
        storage.set(&DataKey::PendingAction(action_hash.clone()), &pending);

        env.events()
            .publish((symbol_short!("approved"), admin), action_hash);
    }

    /// Revoke a previously-given approval.
    pub fn revoke_approval(env: Env, admin: Address, action_hash: BytesN<32>) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let quorum: Vec<Address> = storage
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env));
        assert!(quorum.len() > 0, "no quorum configured");

        let mut pending = storage
            .get(&DataKey::PendingAction(action_hash.clone()))
            .unwrap_or(PendingAction {
                approvers: Vec::new(&env),
                created_at: 0,
            });

        let mut new_approvers = Vec::new(&env);
        let mut found = false;
        for a in pending.approvers.iter() {
            if a == admin {
                found = true;
            } else {
                new_approvers.push_back(a);
            }
        }
        assert!(found, "no approval to revoke");
        pending.approvers = new_approvers;
        storage.set(&DataKey::PendingAction(action_hash.clone()), &pending);
        env.events()
            .publish((symbol_short!("revoked"), admin), action_hash);
    }

    /// Execute an approved action. Requires simple majority (ceil(N/2)) of quorum approvals.
    /// action_type: 1=pause, 2=unpause, 3=emergency_withdraw, 4=remove_member
    pub fn execute_approved(
        env: Env,
        caller: Address,
        action_hash: BytesN<32>,
        action_type: u32,
        target: Address,
    ) {
        caller.require_auth();
        let storage = env.storage().persistent();

        let quorum: Vec<Address> = storage
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env));
        assert!(quorum.len() > 0, "no quorum configured");

        let pending = storage
            .get(&DataKey::PendingAction(action_hash.clone()))
            .unwrap_or(PendingAction {
                approvers: Vec::new(&env),
                created_at: 0,
            });
        assert!(pending.approvers.len() > 0, "action not found");
        assert!(
            env.ledger().timestamp() - pending.created_at < PENDING_ACTION_EXPIRY,
            "action expired"
        );

        let threshold = (quorum.len() as u32 + 1) / 2; // ceil(N/2)
        assert!(
            pending.approvers.len() as u32 >= threshold,
            "insufficient approvals"
        );

        // Clear pending action before executing
        storage.remove(&DataKey::PendingAction(action_hash.clone()));

        // Execute the action
        match action_type {
            1 => {
                // pause
                storage.set(&DataKey::Paused, &true);
                env.events().publish((symbol_short!("paused"),), ());
            }
            2 => {
                // unpause
                storage.set(&DataKey::Paused, &false);
                env.events().publish((symbol_short!("unpaused"),), ());
            }
            3 => {
                // emergency_withdraw
                let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
                assert!(paused, "pool not paused");
                let token_addr: Address = storage.get(&DataKey::Token).unwrap();
                let token_client = token::Client::new(&env, &token_addr);
                let contract_balance = token_client.balance(&env.current_contract_address());
                if contract_balance > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &target,
                        &contract_balance,
                    );
                }
                env.events()
                    .publish((symbol_short!("emrg_wd"),), contract_balance);
            }
            4 => {
                // remove_member
                let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
                let mut new_members = Vec::new(&env);
                let mut found = false;
                for m in members.iter() {
                    if m == target {
                        found = true;
                    } else {
                        new_members.push_back(m);
                    }
                }
                assert!(found, "member not found");
                assert!(new_members.len() >= 1, "must have at least 1 member");
                storage.set(&DataKey::Members, &new_members);
                env.events()
                    .publish((symbol_short!("mem_rm"), target.clone()), ());
            }
            _ => panic!("unknown action type"),
        }

        env.events()
            .publish((symbol_short!("executed"),), action_hash);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    pub fn is_active(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Active)
            .unwrap_or(false)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().persistent().get(&DataKey::Admin).unwrap()
    }

    pub fn current_round(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::CurrentRound)
            .unwrap_or(0)
    }

    pub fn members(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Members)
            .unwrap_or(Vec::new(&env))
    }

    pub fn has_deposited(env: Env, member: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::HasDeposited(member))
            .unwrap_or(false)
    }

    pub fn next_payout_time(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextPayoutTime)
            .unwrap_or(0)
    }

    // ── Quorum views ──────────────────────────────────────────────────────

    pub fn get_admin_quorum(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AdminQuorum)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_approvals(env: Env, action_hash: BytesN<32>) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingAction(action_hash))
            .map(|p: PendingAction| p.approvers)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_approval_count(env: Env, action_hash: BytesN<32>) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PendingAction(action_hash))
            .map(|p: PendingAction| p.approvers.len() as u32)
            .unwrap_or(0)
    }

    pub fn get_action_time(env: Env, action_hash: BytesN<32>) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::PendingAction(action_hash))
            .map(|p: PendingAction| p.created_at)
            .unwrap_or(0)
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    fn is_member(members: &Vec<Address>, who: &Address) -> bool {
        for m in members.iter() {
            if m == *who {
                return true;
            }
        }
        false
    }

    fn is_quorum_member(quorum: &Vec<Address>, who: &Address) -> bool {
        for m in quorum.iter() {
            if m == *who {
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests;