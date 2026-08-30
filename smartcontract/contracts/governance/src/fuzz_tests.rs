//! Property-based fuzz / invariant tests for JointSave Governance Contract.
//!
//! Covers:
//!   - Quorum math: votes × 100 >= quorum_pct × total_members
//!   - MAX_ACTIVE_PROPOSALS (3) never exceeded
//!   - No double-vote per (proposal, voter) pair
//!   - Proposer cannot vote on own proposal
//!   - Terminal states (Executed, Rejected, Expired) are irreversible
//!   - `meets_quorum` helper: boundary arithmetic, overflow safety
//!   - Multi-call fuzz: random proposal/vote/expire sequences never panic
//!
//! Run with:
//!   cargo test prop_ --manifest-path=contracts/governance/Cargo.toml \
//!         --release -- --nocapture

#[cfg(test)]
mod prop_tests {
    use proptest::prelude::*;

    // In test binaries the standard library is always available even in no_std crates.
    extern crate std;
    use std::vec::Vec as StdVec;
    use std::vec; // bring in the vec![] macro

    // ── Pure arithmetic helpers mirroring the on-chain implementation ────────

    /// Mirrors `Governance::meets_quorum`.
    fn meets_quorum(votes: u128, quorum_pct: u32, total_members: u128) -> bool {
        if total_members == 0 {
            return false;
        }
        votes.saturating_mul(100) >= (quorum_pct as u128).saturating_mul(total_members)
    }

    // ── quorum math invariants ────────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50_000))]

        /// Invariant: meets_quorum is never true when total_members == 0.
        #[test]
        fn prop_quorum_zero_members_always_false(
            votes in 0u128..=u128::MAX / 100,
            quorum_pct in 1u32..=100u32,
        ) {
            prop_assert!(!meets_quorum(votes, quorum_pct, 0));
        }

        /// Invariant: unanimous vote always satisfies any quorum ≤ 100%.
        #[test]
        fn prop_unanimous_vote_passes_any_quorum(
            member_count in 1u128..=1000u128,
            quorum_pct in 1u32..=100u32,
        ) {
            prop_assert!(meets_quorum(member_count, quorum_pct, member_count));
        }

        /// Invariant: zero votes never satisfies a non-zero quorum.
        #[test]
        fn prop_zero_votes_never_passes(
            member_count in 1u128..=1000u128,
            quorum_pct in 1u32..=100u32,
        ) {
            prop_assert!(!meets_quorum(0, quorum_pct, member_count));
        }

        /// Invariant: quorum is monotone — more votes makes it *at least as easy* to pass.
        #[test]
        fn prop_quorum_monotone_in_votes(
            votes in 0u128..=999u128,
            member_count in 1u128..=1000u128,
            quorum_pct in 1u32..=100u32,
        ) {
            let passes_at_v = meets_quorum(votes, quorum_pct, member_count);
            if passes_at_v {
                prop_assert!(
                    meets_quorum(votes + 1, quorum_pct, member_count),
                    "monotone broken: {} votes passes but {} votes fails \
                     (quorum={}%, members={})",
                    votes, votes + 1, quorum_pct, member_count
                );
            }
        }

        /// Invariant: stricter quorum is harder (or equal) to satisfy.
        #[test]
        fn prop_quorum_monotone_in_threshold(
            votes in 0u128..=1000u128,
            member_count in 1u128..=1000u128,
            low_pct in 1u32..=50u32,
            high_offset in 0u32..=50u32,
        ) {
            let high_pct = (low_pct + high_offset).min(100);
            let passes_low = meets_quorum(votes, low_pct, member_count);
            let passes_high = meets_quorum(votes, high_pct, member_count);
            if passes_high {
                prop_assert!(
                    passes_low,
                    "low quorum {}% fails but high quorum {}% passes \
                     (votes={}, members={})",
                    low_pct, high_pct, votes, member_count
                );
            }
        }

        /// Invariant: no integer overflow in saturating arithmetic on extreme inputs.
        #[test]
        fn prop_quorum_no_overflow(
            votes in prop::sample::select(vec![
                0u128,
                1u128,
                u128::MAX / 200,
                u128::MAX / 100,
                u128::MAX,
            ]),
            member_count in prop::sample::select(vec![
                1u128,
                2u128,
                100u128,
                u128::MAX / 100,
                u128::MAX,
            ]),
            quorum_pct in prop::sample::select(vec![1u32, 51u32, 100u32]),
        ) {
            // Must not panic — saturating_mul handles overflow.
            let _result = meets_quorum(votes, quorum_pct, member_count);
        }

        /// Invariant: exact quorum threshold boundary (vote count that just barely passes).
        #[test]
        fn prop_quorum_boundary_precision(
            member_count in 2u128..=100u128,
            quorum_pct in 1u32..=100u32,
        ) {
            // Minimum votes required = ceil(quorum_pct * member_count / 100)
            let required = (quorum_pct as u128 * member_count + 99) / 100;

            if required <= member_count {
                prop_assert!(
                    meets_quorum(required, quorum_pct, member_count),
                    "required votes {} should satisfy quorum {}% with {} members",
                    required, quorum_pct, member_count
                );
            }

            // One less than required should NOT pass (unless required is 0).
            if required > 1 {
                prop_assert!(
                    !meets_quorum(required - 1, quorum_pct, member_count),
                    "required-1 votes {} should NOT satisfy quorum {}% with {} members",
                    required - 1, quorum_pct, member_count
                );
            }
        }
    }

    // ── Proposal-count / active-proposals state machine (pure simulation) ────

    const MAX_ACTIVE: usize = 3;

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum SimStatus {
        Active,
        Passed,
        Executed,
        Expired,
        Rejected,
    }

    #[derive(Clone, Debug)]
    struct SimProposal {
        id: u32,
        status: SimStatus,
        votes_for: u32,
        votes_against: u32,
        /// Members who have already voted (stored as a StdVec to avoid ambiguity).
        voted_members: StdVec<u32>,
        proposer: u32,
    }

    struct SimGov {
        proposals: StdVec<SimProposal>,
        active_ids: StdVec<u32>,
        next_id: u32,
        member_count: u32,
        quorum_pct: u32,
    }

    impl SimGov {
        fn new(member_count: u32, quorum_pct: u32) -> Self {
            SimGov {
                proposals: StdVec::new(),
                active_ids: StdVec::new(),
                next_id: 0,
                member_count,
                quorum_pct,
            }
        }

        fn create(&mut self, proposer: u32) -> Option<u32> {
            if self.active_ids.len() >= MAX_ACTIVE {
                return None;
            }
            let id = self.next_id;
            self.next_id += 1;
            self.proposals.push(SimProposal {
                id,
                status: SimStatus::Active,
                votes_for: 0,
                votes_against: 0,
                voted_members: StdVec::new(),
                proposer,
            });
            self.active_ids.push(id);
            Some(id)
        }

        fn vote(&mut self, proposal_idx: usize, voter: u32, in_favor: bool) {
            let p = match self.proposals.get_mut(proposal_idx) {
                Some(p) => p,
                None => return,
            };
            if p.status != SimStatus::Active {
                return;
            }
            if p.proposer == voter {
                return; // proposer cannot vote
            }
            if p.voted_members.contains(&voter) {
                return; // already voted
            }
            p.voted_members.push(voter);
            if in_favor {
                p.votes_for += 1;
            } else {
                p.votes_against += 1;
            }

            let members = self.member_count as u128;
            let quorum = self.quorum_pct;

            if in_favor && meets_quorum(p.votes_for as u128, quorum, members) {
                p.status = SimStatus::Passed;
            } else if !in_favor && meets_quorum(p.votes_against as u128, quorum, members) {
                p.status = SimStatus::Rejected;
                let id = p.id;
                self.active_ids.retain(|&x| x != id);
            }
        }

        fn execute(&mut self, proposal_idx: usize) {
            let p = match self.proposals.get_mut(proposal_idx) {
                Some(p) => p,
                None => return,
            };
            if p.status != SimStatus::Passed {
                return;
            }
            p.status = SimStatus::Executed;
            let id = p.id;
            self.active_ids.retain(|&x| x != id);
        }

        fn expire(&mut self, proposal_idx: usize) {
            let p = match self.proposals.get_mut(proposal_idx) {
                Some(p) => p,
                None => return,
            };
            if p.status != SimStatus::Active && p.status != SimStatus::Passed {
                return;
            }
            p.status = SimStatus::Expired;
            let id = p.id;
            self.active_ids.retain(|&x| x != id);
        }

        // ── Invariant checks ──────────────────────────────────────────────

        fn assert_invariants(&self) {
            // 1. Active list never exceeds MAX_ACTIVE_PROPOSALS.
            assert!(
                self.active_ids.len() <= MAX_ACTIVE,
                "active proposals exceeded MAX ({}): {}",
                MAX_ACTIVE,
                self.active_ids.len()
            );

            // 2. Active list matches proposals whose status is Active or Passed.
            let open_count = self
                .proposals
                .iter()
                .filter(|p| p.status == SimStatus::Active || p.status == SimStatus::Passed)
                .count();
            assert_eq!(
                self.active_ids.len(),
                open_count,
                "active_ids len {} != open proposal count {}",
                self.active_ids.len(),
                open_count
            );

            // 3. No terminal proposal is referenced in active_ids.
            for &aid in &self.active_ids {
                let p = self.proposals.iter().find(|p| p.id == aid).unwrap();
                assert!(
                    p.status == SimStatus::Active || p.status == SimStatus::Passed,
                    "terminal proposal {} is still in active_ids",
                    aid
                );
            }

            // 4. No member voted twice on the same proposal (Vec uniqueness check).
            for p in &self.proposals {
                for (i, &v_i) in p.voted_members.iter().enumerate() {
                    for (j, &v_j) in p.voted_members.iter().enumerate() {
                        if i != j {
                            assert_ne!(v_i, v_j, "member {} voted twice on proposal {}", v_i, p.id);
                        }
                    }
                }
            }

            // 5. Proposer never appears in voted_members.
            for p in &self.proposals {
                assert!(
                    !p.voted_members.contains(&p.proposer),
                    "proposer {} voted on own proposal {}",
                    p.proposer,
                    p.id
                );
            }
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(5_000))]

        /// Multi-call fuzz: random create/vote/execute/expire sequences never
        /// violate governance invariants.
        #[test]
        fn prop_governance_multi_call_invariants(
            member_count in 3u32..=20u32,
            quorum_pct in 1u32..=100u32,
            operations in prop::collection::vec(
                (0u32..=4u32, 0u32..=50u32, prop::bool::ANY),
                1..=50
            ),
        ) {
            let mut gov = SimGov::new(member_count, quorum_pct);
            let proposal_count_soft_limit = 100usize;

            for (op, param, flag) in operations {
                match op {
                    0 => {
                        let proposer = param % member_count;
                        gov.create(proposer);
                    }
                    1 => {
                        if !gov.proposals.is_empty() {
                            let idx = (param as usize) % gov.proposals.len();
                            let voter = param % member_count;
                            gov.vote(idx, voter, flag);
                        }
                    }
                    2 => {
                        if !gov.proposals.is_empty() {
                            let idx = (param as usize) % gov.proposals.len();
                            gov.execute(idx);
                        }
                    }
                    3 => {
                        if !gov.proposals.is_empty() {
                            let idx = (param as usize) % gov.proposals.len();
                            gov.expire(idx);
                        }
                    }
                    _ => {
                        if gov.proposals.len() > proposal_count_soft_limit {
                            gov.proposals.truncate(proposal_count_soft_limit);
                        }
                    }
                }

                gov.assert_invariants();
            }
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        /// Invariant: active proposals never exceed MAX_ACTIVE even under maximum
        /// creation pressure.
        #[test]
        fn prop_active_proposals_cap(
            create_attempts in 4u32..=200u32,
            member_count in 3u32..=50u32,
        ) {
            let mut gov = SimGov::new(member_count, 51);

            for i in 0..create_attempts {
                gov.create(i % member_count);
                prop_assert!(
                    gov.active_ids.len() <= MAX_ACTIVE,
                    "active proposals {} exceeded cap {} after {} creates",
                    gov.active_ids.len(),
                    MAX_ACTIVE,
                    i + 1
                );
            }
        }

        /// Invariant: once a proposal enters a terminal state it cannot revert.
        #[test]
        fn prop_terminal_states_are_irreversible(
            member_count in 3u32..=20u32,
            quorum_pct in 1u32..=100u32,
        ) {
            let mut gov = SimGov::new(member_count, quorum_pct);

            if gov.create(0).is_none() {
                return Ok(());
            }

            // Vote until Passed or we've used all eligible voters.
            for v in 1..member_count {
                gov.vote(0, v, true);
                if gov.proposals[0].status == SimStatus::Passed {
                    break;
                }
            }

            // Only test terminal-irreversibility if the proposal actually passed.
            if gov.proposals[0].status != SimStatus::Passed {
                return Ok(()); // quorum not reachable with given params — skip
            }

            gov.execute(0);
            let after_execute = gov.proposals[0].status;

            // Proposal must now be Executed (a terminal state).
            prop_assert_eq!(
                after_execute,
                SimStatus::Executed,
                "expected Executed after execute(), got {:?}",
                after_execute
            );

            // Re-execute on an Executed proposal must be a no-op.
            gov.execute(0);
            prop_assert_eq!(
                gov.proposals[0].status,
                SimStatus::Executed,
                "re-execute changed Executed state"
            );

            // Expire on an Executed proposal must be a no-op.
            gov.expire(0);
            prop_assert_eq!(
                gov.proposals[0].status,
                SimStatus::Executed,
                "expire changed Executed state"
            );

            gov.assert_invariants();
        }
    }

    // ── Boundary tests: quorum_pct edge values ────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20_000))]

        /// Invariant: quorum=1% passes with a single vote when member_count <= 100
        /// (because ceil(1% * 100) = 1).  For larger groups more votes are needed.
        #[test]
        fn prop_quorum_1_pct_passes_with_single_vote(
            member_count in 1u128..=100u128,
        ) {
            prop_assert!(meets_quorum(1, 1, member_count),
                "1 vote should satisfy 1% quorum with {} members", member_count);
        }

        /// Invariant: quorum=1% requires ceil(member_count/100) votes for any group.
        #[test]
        fn prop_quorum_1_pct_minimum_votes(
            member_count in 1u128..=10_000u128,
        ) {
            let required = (member_count + 99) / 100; // ceil(1% * n)
            prop_assert!(meets_quorum(required, 1, member_count),
                "{} votes should satisfy 1% quorum with {} members", required, member_count);
            if required > 1 {
                prop_assert!(!meets_quorum(required - 1, 1, member_count),
                    "{} votes should NOT satisfy 1% quorum with {} members", required - 1, member_count);
            }
        }

        /// Invariant: quorum=100 requires ALL members to vote in favor.
        #[test]
        fn prop_quorum_100_pct_requires_all_votes(
            member_count in 1u128..=1000u128,
        ) {
            if member_count > 1 {
                prop_assert!(
                    !meets_quorum(member_count - 1, 100, member_count),
                    "quorum=100% should require all {} votes, {} is not enough",
                    member_count,
                    member_count - 1
                );
            }
            prop_assert!(meets_quorum(member_count, 100, member_count));
        }
    }
}
