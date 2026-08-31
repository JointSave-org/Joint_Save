#![no_std]

#[cfg(test)]
mod fuzz_tests;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, IntoVal, Map,
    String, Symbol, Vec,
};

const VERSION: u32 = 1;

const MAX_ACTIVE_PROPOSALS: u32 = 3;
const MAX_RECENT_PROPOSALS: u32 = 50;
const DEFAULT_VOTING_PERIOD_SECS: u64 = 48 * 60 * 60;

const LEDGER_THRESHOLD: u32 = 518400;
const LEDGER_BUMP: u32 = 2592000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalType {
    ChangeDepositAmount,
    ExtendDeadline,
    AddPenalty,
    RemovePenalty,
    ChangeQuorum,
    Custom,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Executed,
    Expired,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: BytesN<32>,
    pub proposer: Address,
    pub proposal_type: ProposalType,
    pub description: String,
    pub parameters: Map<String, Bytes>,
    pub votes_for: Vec<Address>,
    pub votes_against: Vec<Address>,
    pub status: ProposalStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub execution_result: Option<Bytes>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    PoolContract,
    VotingQuorum,
    ProposalCount,
    Proposal(BytesN<32>),
    ActiveProposals,
    RecentProposals,
    Vote(BytesN<32>, Address),
}

#[contract]
pub struct Governance;

fn voting_period() -> u64 {
    DEFAULT_VOTING_PERIOD_SECS
}

#[contractimpl]
impl Governance {
    /// Attach this governance contract to a pool. The quorum is expressed as a
    /// percentage of total pool members (e.g. 51 means 51% must vote in favor).
    pub fn initialize(env: Env, admin: Address, pool_contract: Address, voting_quorum: u32) {
        admin.require_auth();

        let storage = env.storage().persistent();
        assert!(!storage.has(&DataKey::Admin), "already initialized");
        assert!((1..=100).contains(&voting_quorum), "quorum must be 1-100");

        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::PoolContract, &pool_contract);
        storage.set(&DataKey::VotingQuorum, &voting_quorum);
        storage.set(&DataKey::ProposalCount, &0u64);
        storage.set(&DataKey::ActiveProposals, &Vec::<BytesN<32>>::new(&env));
        storage.set(&DataKey::RecentProposals, &Vec::<BytesN<32>>::new(&env));

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("gov_init"), pool_contract), voting_quorum);
    }

    /// Admin override for the quorum percentage (governance itself can also
    /// change it via a ChangeQuorum proposal).
    pub fn set_voting_quorum(env: Env, admin: Address, voting_quorum: u32) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        assert!((1..=100).contains(&voting_quorum), "quorum must be 1-100");

        storage.set(&DataKey::VotingQuorum, &voting_quorum);
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("quorum"),), voting_quorum);
    }

    /// Create a new proposal. Only current members of the attached pool may
    /// propose; at most `MAX_ACTIVE_PROPOSALS` proposals can be open at once.
    ///
    /// Parameters are serialized per proposal type as big-endian i128 values
    /// under well-known keys:
    ///   - ChangeDepositAmount -> "deposit_amount"
    ///   - ExtendDeadline      -> "seconds"
    ///   - AddPenalty          -> "percentage"
    ///   - RemovePenalty       -> (no parameter required)
    ///   - ChangeQuorum        -> "quorum"
    ///   - Custom              -> free-form
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        proposal_type: ProposalType,
        description: String,
        parameters: Map<String, Bytes>,
    ) -> BytesN<32> {
        proposer.require_auth();
        Self::assert_pool_member(&env, &proposer);
        assert!(!description.is_empty(), "description required");
        assert!(description.len() <= 500, "description too long");

        let storage = env.storage().persistent();
        let active: Vec<BytesN<32>> = storage.get(&DataKey::ActiveProposals).unwrap();
        assert!(
            active.len() < MAX_ACTIVE_PROPOSALS,
            "too many active proposals"
        );
        assert!(
            !(proposal_type == ProposalType::Custom && parameters.is_empty()),
            "custom proposal requires parameters"
        );

        let count: u64 = storage.get(&DataKey::ProposalCount).unwrap_or(0) + 1;
        let id = Self::proposal_id(&env, env.ledger().timestamp(), count);
        let created_at = env.ledger().timestamp();
        let expires_at = created_at + voting_period();

        let proposal = Proposal {
            id: id.clone(),
            proposer: proposer.clone(),
            proposal_type,
            description,
            parameters,
            votes_for: Vec::new(&env),
            votes_against: Vec::new(&env),
            status: ProposalStatus::Active,
            created_at,
            expires_at,
            execution_result: None,
        };

        storage.set(&DataKey::ProposalCount, &count);
        storage.set(&DataKey::Proposal(id.clone()), &proposal);

        let mut active: Vec<BytesN<32>> = active;
        active.push_back(id.clone());
        storage.set(&DataKey::ActiveProposals, &active);

        let mut recent: Vec<BytesN<32>> = storage.get(&DataKey::RecentProposals).unwrap();
        recent.push_back(id.clone());
        if recent.len() > MAX_RECENT_PROPOSALS {
            recent.remove(0);
        }
        storage.set(&DataKey::RecentProposals, &recent);

        Self::bump_proposal_state_internal(&env, &id);
        Self::bump_config_state_internal(&env);

        env.events().publish(
            (symbol_short!("prop_new"), proposer),
            (id.clone(), created_at, expires_at),
        );

        id
    }

    /// Cast a vote. One vote per member per proposal; the proposer cannot vote
    /// on their own proposal. If enough members vote against (same threshold
    /// as the pass quorum), the proposal is rejected immediately.
    pub fn vote(env: Env, voter: Address, proposal_id: BytesN<32>, in_favor: bool) {
        voter.require_auth();
        Self::assert_pool_member(&env, &voter);

        let storage = env.storage().persistent();
        let mut proposal: Proposal = storage
            .get(&DataKey::Proposal(proposal_id.clone()))
            .unwrap();

        assert!(
            env.ledger().timestamp() < proposal.expires_at,
            "proposal expired"
        );
        assert_eq!(proposal.status, ProposalStatus::Active, "not active");
        assert!(voter != proposal.proposer, "proposer cannot vote");
        assert!(
            !storage.has(&DataKey::Vote(proposal_id.clone(), voter.clone())),
            "already voted"
        );

        storage.set(
            &DataKey::Vote(proposal_id.clone(), voter.clone()),
            &in_favor,
        );

        if in_favor {
            proposal.votes_for.push_back(voter.clone());
        } else {
            proposal.votes_against.push_back(voter.clone());
        }

        let total_members = Self::pool_member_count(&env);
        let quorum = Self::get_voting_quorum(env.clone());
        let for_votes = proposal.votes_for.len();
        let against_votes = proposal.votes_against.len();

        // Quorum reached on the "against" side rejects the proposal outright.
        if !in_favor && Self::meets_quorum(against_votes as u128, quorum, total_members as u128) {
            Self::remove_from_active(&env, &proposal_id);
            proposal.status = ProposalStatus::Rejected;
            storage.set(&DataKey::Proposal(proposal_id.clone()), &proposal);
            Self::bump_config_state_internal(&env);
            env.events()
                .publish((symbol_short!("prop_rej"), proposal_id), against_votes);
            return;
        }

        if Self::meets_quorum(for_votes as u128, quorum, total_members as u128)
            && proposal.status == ProposalStatus::Active
        {
            proposal.status = ProposalStatus::Passed;
        }

        storage.set(&DataKey::Proposal(proposal_id.clone()), &proposal);
        Self::bump_proposal_state_internal(&env, &proposal_id);
        Self::bump_config_state_internal(&env);

        env.events().publish(
            (symbol_short!("vote_cast"), voter),
            (proposal_id.clone(), in_favor, for_votes, against_votes),
        );
    }

    /// Execute a passed proposal. Requires the voting window to still be open
    /// and the "for" quorum to be met. Applies the change to the target pool
    /// via a cross-contract call to `apply_governance_proposal`.
    pub fn execute_proposal(env: Env, executor: Address, proposal_id: BytesN<32>) {
        executor.require_auth();
        Self::assert_pool_member(&env, &executor);

        let storage = env.storage().persistent();
        let mut proposal: Proposal = storage
            .get(&DataKey::Proposal(proposal_id.clone()))
            .unwrap();

        assert!(proposal.status == ProposalStatus::Passed, "quorum not met");
        assert!(
            env.ledger().timestamp() < proposal.expires_at,
            "proposal expired"
        );

        let result = Self::dispatch(&env, &proposal);

        Self::remove_from_active(&env, &proposal_id);
        proposal.status = ProposalStatus::Executed;
        proposal.execution_result = Some(result);
        storage.set(&DataKey::Proposal(proposal_id.clone()), &proposal);
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("prop_exec"), proposal_id), ());
    }

    /// Finalize a proposal whose voting window has closed without execution.
    /// Expired proposals are terminal and can no longer be voted on.
    pub fn expire_proposal(env: Env, executor: Address, proposal_id: BytesN<32>) {
        executor.require_auth();
        Self::assert_pool_member(&env, &executor);

        let storage = env.storage().persistent();
        let mut proposal: Proposal = storage
            .get(&DataKey::Proposal(proposal_id.clone()))
            .unwrap();

        assert!(
            env.ledger().timestamp() >= proposal.expires_at,
            "voting period not over"
        );
        assert!(
            proposal.status == ProposalStatus::Active || proposal.status == ProposalStatus::Passed,
            "already finalized"
        );

        Self::mark_expired(&env, &mut proposal);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    pub fn get_version(_env: Env) -> u32 {
        VERSION
    }

    pub fn get_proposal(env: Env, proposal_id: BytesN<32>) -> Proposal {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap()
    }

    pub fn has_voted(env: Env, proposal_id: BytesN<32>, voter: Address) -> Option<bool> {
        env.storage()
            .persistent()
            .get(&DataKey::Vote(proposal_id, voter))
    }

    /// All proposals currently inside their voting window. The `pool_contract`
    /// argument must match the pool this governance contract is attached to.
    pub fn get_active_proposals(env: Env, pool_contract: Address) -> Vec<Proposal> {
        let stored_pool: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PoolContract)
            .unwrap();
        assert!(pool_contract == stored_pool, "wrong pool");

        let ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveProposals)
            .unwrap();
        Self::load_proposals(&env, &ids)
    }

    /// Most recent proposals (executed, rejected, expired included).
    pub fn get_recent_proposals(env: Env) -> Vec<Proposal> {
        let ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::RecentProposals)
            .unwrap();
        Self::load_proposals(&env, &ids)
    }

    pub fn get_voting_quorum(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::VotingQuorum)
            .unwrap_or(51)
    }

    pub fn voting_period_secs(_env: Env) -> u64 {
        voting_period()
    }

    pub fn admin(env: Env) -> Address {
        env.storage().persistent().get(&DataKey::Admin).unwrap()
    }

    pub fn pool_contract(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::PoolContract)
            .unwrap()
    }

    pub fn bump_state(env: Env) {
        Self::bump_config_state_internal(&env);
        let recent: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::RecentProposals)
            .unwrap_or(Vec::new(&env));
        for id in recent.iter() {
            let key = DataKey::Proposal(id.clone());
            if env.storage().persistent().has(&key) {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
    }

    /// Migrate this contract to a new version. Admin-only.
    pub fn migrate(env: Env, admin: Address, to_version: u32) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let current = VERSION;
        if to_version == current {
            return;
        }
        assert!(
            to_version == current + 1,
            "version must be incremented by exactly 1"
        );

        env.events()
            .publish((symbol_short!("migrated"), admin), to_version);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    fn proposal_id(env: &Env, created_at: u64, count: u64) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&created_at.to_be_bytes());
        bytes[16..24].copy_from_slice(&count.to_be_bytes());
        BytesN::from_array(env, &bytes)
    }

    fn meets_quorum(votes: u128, quorum_pct: u32, total_members: u128) -> bool {
        if total_members == 0 {
            return false;
        }
        votes.saturating_mul(100) >= (quorum_pct as u128).saturating_mul(total_members)
    }

    fn assert_pool_member(env: &Env, who: &Address) {
        let pool: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PoolContract)
            .unwrap();
        let members: Vec<Address> =
            env.invoke_contract(&pool, &symbol_short!("members"), soroban_sdk::vec![env]);
        let mut found = false;
        for m in members.iter() {
            if m == *who {
                found = true;
                break;
            }
        }
        assert!(found, "not a pool member");
    }

    fn pool_member_count(env: &Env) -> u32 {
        let pool: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PoolContract)
            .unwrap();
        let members: Vec<Address> =
            env.invoke_contract(&pool, &symbol_short!("members"), soroban_sdk::vec![env]);
        members.len()
    }

    fn load_proposals(env: &Env, ids: &Vec<BytesN<32>>) -> Vec<Proposal> {
        let mut out = Vec::new(env);
        for id in ids.iter() {
            if let Some(p) = env
                .storage()
                .persistent()
                .get::<DataKey, Proposal>(&DataKey::Proposal(id.clone()))
            {
                out.push_back(p);
            }
        }
        out
    }

    fn remove_from_active(env: &Env, proposal_id: &BytesN<32>) {
        let storage = env.storage().persistent();
        let active: Vec<BytesN<32>> = storage.get(&DataKey::ActiveProposals).unwrap();
        let mut updated = Vec::new(env);
        for id in active.iter() {
            if id != *proposal_id {
                updated.push_back(id);
            }
        }
        storage.set(&DataKey::ActiveProposals, &updated);
    }

    fn mark_expired(env: &Env, proposal: &mut Proposal) {
        let id = proposal.id.clone();
        Self::remove_from_active(env, &id);
        proposal.status = ProposalStatus::Expired;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(id.clone()), proposal);
        env.events().publish((symbol_short!("prop_exp"), id), ());
    }

    /// Apply the proposal: either update governance config directly or invoke
    /// the pool contract's `apply_governance_proposal` entrypoint.
    fn dispatch(env: &Env, proposal: &Proposal) -> Bytes {
        let value_key = match proposal.proposal_type {
            ProposalType::ChangeDepositAmount => "deposit_amount",
            ProposalType::ExtendDeadline => "seconds",
            ProposalType::AddPenalty => "percentage",
            ProposalType::RemovePenalty => "",
            ProposalType::ChangeQuorum => "quorum",
            ProposalType::Custom => "",
        };

        let raw_value: Option<Bytes> = if !value_key.is_empty() {
            let key = String::from_str(env, value_key);
            let v = proposal.parameters.get(key);
            assert!(v.is_some(), "missing parameter");
            v
        } else {
            None
        };

        match proposal.proposal_type {
            ProposalType::ChangeQuorum => {
                let value = Self::require_i128(env, &raw_value);
                assert!((1..=100).contains(&value), "quorum must be 1-100");
                env.storage()
                    .persistent()
                    .set(&DataKey::VotingQuorum, &(value as u32));
                format_result(env, "quorum", value)
            }
            ProposalType::RemovePenalty => {
                let gov = env.current_contract_address();
                let pool: Address = env
                    .storage()
                    .persistent()
                    .get(&DataKey::PoolContract)
                    .unwrap();
                let _: () = env.invoke_contract(
                    &pool,
                    &Symbol::new(env, "apply_governance_proposal"),
                    soroban_sdk::vec![
                        env,
                        gov.into_val(env),
                        Symbol::new(env, "remove_penalty").into_val(env),
                        0i128.into_val(env),
                    ],
                );
                format_result(env, "penalty", 0)
            }
            ProposalType::Custom => {
                let len = proposal.parameters.len();
                format_result(env, "custom", len as i128)
            }
            _ => {
                let value = Self::require_i128(env, &raw_value);
                let type_symbol = match proposal.proposal_type {
                    ProposalType::ChangeDepositAmount => "change_deposit_amount",
                    ProposalType::ExtendDeadline => "extend_deadline",
                    ProposalType::AddPenalty => "add_penalty",
                    _ => unreachable!(),
                };
                let gov = env.current_contract_address();
                let pool: Address = env
                    .storage()
                    .persistent()
                    .get(&DataKey::PoolContract)
                    .unwrap();
                let _: () = env.invoke_contract(
                    &pool,
                    &Symbol::new(env, "apply_governance_proposal"),
                    soroban_sdk::vec![
                        env,
                        gov.into_val(env),
                        Symbol::new(env, type_symbol).into_val(env),
                        value.into_val(env),
                    ],
                );
                format_result(env, type_symbol, value)
            }
        }
    }

    fn require_i128(env: &Env, raw: &Option<Bytes>) -> i128 {
        let bytes = raw.as_ref().expect("missing parameter");
        assert!(bytes.len() == 16, "invalid parameter encoding");
        let mut arr = [0u8; 16];
        for i in 0..16u32 {
            arr[i as usize] = bytes.get(i).unwrap();
        }
        let _ = env;
        i128::from_be_bytes(arr)
    }

    fn bump_config_state_internal(env: &Env) {
        let storage = env.storage().persistent();
        storage.extend_ttl(&DataKey::Admin, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::PoolContract, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::VotingQuorum, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::ProposalCount, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::ActiveProposals, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::RecentProposals, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn bump_proposal_state_internal(env: &Env, id: &BytesN<32>) {
        let storage = env.storage().persistent();
        let key = DataKey::Proposal(id.clone());
        if storage.has(&key) {
            storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }
}

fn format_result(env: &Env, label: &str, value: i128) -> Bytes {
    let mut buf = [0u8; 64];
    let mut n = 0usize;
    for b in label.as_bytes() {
        buf[n] = *b;
        n += 1;
    }
    buf[n] = b'=';
    n += 1;
    if value < 0 {
        buf[n] = b'-';
        n += 1;
    }
    let start = n;
    let mut v = value.unsigned_abs();
    if v == 0 {
        buf[n] = b'0';
        n += 1;
    }
    while v > 0 {
        buf[n] = (v % 10) as u8 + b'0';
        n += 1;
        v /= 10;
    }
    let mut lo = start;
    let mut hi = n - 1;
    while lo < hi {
        buf.swap(lo, hi);
        lo += 1;
        hi -= 1;
    }
    Bytes::from_slice(env, &buf[..n])
}

#[cfg(test)]
mod tests;
