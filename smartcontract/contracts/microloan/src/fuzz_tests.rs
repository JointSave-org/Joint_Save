//! Property-based fuzz / invariant tests for JointSave Microloan Contract.
//!
//! Uses a pure-arithmetic simulation of the loan lifecycle that mirrors the
//! on-chain logic in lib.rs.  This avoids the Soroban testutils entirely,
//! which lets proptest generate thousands of random inputs in a normal Rust
//! test environment without requiring a live Env or mock contracts.
//!
//! Covered invariants:
//!   - total_owed = principal + (principal × rate / 10_000); always ≥ principal
//!   - remaining = total_owed − repaid_amount; never negative
//!   - repaid_amount never exceeds total_owed
//!   - State machine: Pending → Active → Repaid/Defaulted; Pending → Cancelled
//!   - No double-repay beyond total_owed (repaid capped at total_owed)
//!   - MAX_ACTIVE_LOANS (3) never exceeded per member
//!   - Interest calculation is overflow-safe for inputs up to i128::MAX/10_000
//!   - Multi-call fuzz: create/accept/repay/cancel sequences keep all invariants
//!   - Boundary: 0 bps, 5000 bps, amounts at 1, i128::MAX/10_000
//!
//! Run with:
//!   cargo test prop_ --manifest-path=contracts/microloan/Cargo.toml \
//!         --release -- --nocapture

#[cfg(test)]
mod prop_tests {
    use proptest::prelude::*;

    extern crate std;
    use std::vec::Vec as StdVec;
    macro_rules! std_vec {
        ($($x:expr),* $(,)?) => {
            <StdVec<_>>::from([$($x),*])
        };
    }

    // ── On-chain constants (must match lib.rs) ────────────────────────────────

    const MAX_INTEREST_RATE_BPS: u32 = 5_000;
    const MAX_TERM_DAYS: u64 = 365;
    const MAX_ACTIVE_LOANS: u32 = 3;

    // ── Pure mirrors of on-chain arithmetic ───────────────────────────────────

    fn total_owed(principal: i128, interest_rate_bps: u32) -> i128 {
        let interest = principal
            .checked_mul(interest_rate_bps as i128)
            .unwrap_or(0)
            / 10_000_i128;
        principal + interest
    }

    fn remaining(principal: i128, interest_rate_bps: u32, repaid: i128) -> i128 {
        let owed = total_owed(principal, interest_rate_bps);
        if repaid >= owed {
            0
        } else {
            owed - repaid
        }
    }

    // ── Loan status simulation ────────────────────────────────────────────────

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum SimStatus {
        Pending,
        Active,
        Repaid,
        Defaulted,
        Cancelled,
    }

    #[derive(Clone, Debug)]
    struct SimLoan {
        id: u32,
        borrower: u32,
        lender: Option<u32>,
        amount: i128,
        interest_rate_bps: u32,
        term_days: u64,
        status: SimStatus,
        repaid_amount: i128,
        due_ts: u64,
    }

    impl SimLoan {
        fn total_owed(&self) -> i128 {
            total_owed(self.amount, self.interest_rate_bps)
        }

        fn remaining(&self) -> i128 {
            remaining(self.amount, self.interest_rate_bps, self.repaid_amount)
        }
    }

    struct MicroloanSim {
        loans: StdVec<SimLoan>,
        next_id: u32,
        /// Per-member active loan count (member_id → count).
        active_counts: StdVec<(u32, u32)>,
    }

    impl MicroloanSim {
        fn new() -> Self {
            MicroloanSim {
                loans: StdVec::new(),
                next_id: 0,
                active_counts: StdVec::new(),
            }
        }

        fn active_count(&self, member: u32) -> u32 {
            self.active_counts
                .iter()
                .find(|&&(id, _)| id == member)
                .map(|&(_, c)| c)
                .unwrap_or(0)
        }

        fn change_active_count(&mut self, member: u32, delta: i32) {
            if let Some(entry) = self.active_counts.iter_mut().find(|(id, _)| *id == member) {
                entry.1 = (entry.1 as i32 + delta).max(0) as u32;
            } else if delta > 0 {
                self.active_counts.push((member, delta as u32));
            }
        }

        fn create_loan(
            &mut self,
            borrower: u32,
            amount: i128,
            interest_rate_bps: u32,
            term_days: u64,
            members: &StdVec<u32>,
        ) -> Option<u32> {
            // Validation guards
            if amount <= 0 {
                return None;
            }
            if interest_rate_bps > MAX_INTEREST_RATE_BPS {
                return None;
            }
            if term_days < 1 || term_days > MAX_TERM_DAYS {
                return None;
            }
            if !members.contains(&borrower) {
                return None;
            }
            if self.active_count(borrower) >= MAX_ACTIVE_LOANS {
                return None;
            }

            let id = self.next_id;
            self.next_id += 1;
            self.loans.push(SimLoan {
                id,
                borrower,
                lender: None,
                amount,
                interest_rate_bps,
                term_days,
                status: SimStatus::Pending,
                repaid_amount: 0,
                due_ts: 0,
            });
            Some(id)
        }

        fn accept_loan(
            &mut self,
            loan_id: u32,
            lender: u32,
            now_ts: u64,
            members: &StdVec<u32>,
        ) -> bool {
            let idx = match self.loans.iter().position(|l| l.id == loan_id) {
                Some(i) => i,
                None => return false,
            };
            if self.loans[idx].status != SimStatus::Pending {
                return false;
            }
            if self.loans[idx].borrower == lender {
                return false; // lender ≠ borrower
            }
            if !members.contains(&lender) {
                return false;
            }
            if self.active_count(lender) >= MAX_ACTIVE_LOANS {
                return false;
            }

            let term = self.loans[idx].term_days;
            let borrower = self.loans[idx].borrower;
            self.loans[idx].lender = Some(lender);
            self.loans[idx].due_ts = now_ts + term * 86_400;
            self.loans[idx].status = SimStatus::Active;
            self.change_active_count(borrower, 1);
            self.change_active_count(lender, 1);
            true
        }

        fn repay_loan(&mut self, loan_id: u32, repay_amount: i128) -> bool {
            if repay_amount <= 0 {
                return false;
            }
            let idx = match self.loans.iter().position(|l| l.id == loan_id) {
                Some(i) => i,
                None => return false,
            };
            if self.loans[idx].status != SimStatus::Active {
                return false;
            }
            let remaining = self.loans[idx].remaining();
            if repay_amount > remaining {
                return false; // contract panics on this
            }
            let borrower = self.loans[idx].borrower;
            let lender = self.loans[idx].lender;
            self.loans[idx].repaid_amount += repay_amount;
            if self.loans[idx].repaid_amount >= self.loans[idx].total_owed() {
                self.loans[idx].status = SimStatus::Repaid;
                self.change_active_count(borrower, -1);
                if let Some(l) = lender {
                    self.change_active_count(l, -1);
                }
            }
            true
        }

        fn cancel_loan(&mut self, loan_id: u32) -> bool {
            let idx = match self.loans.iter().position(|l| l.id == loan_id) {
                Some(i) => i,
                None => return false,
            };
            if self.loans[idx].status != SimStatus::Pending {
                return false;
            }
            self.loans[idx].status = SimStatus::Cancelled;
            true
        }

        fn default_loan(&mut self, loan_id: u32, now_ts: u64) -> bool {
            let idx = match self.loans.iter().position(|l| l.id == loan_id) {
                Some(i) => i,
                None => return false,
            };
            if self.loans[idx].status != SimStatus::Active {
                return false;
            }
            if now_ts <= self.loans[idx].due_ts {
                return false;
            }
            let borrower = self.loans[idx].borrower;
            let lender = self.loans[idx].lender;
            self.loans[idx].status = SimStatus::Defaulted;
            self.change_active_count(borrower, -1);
            if let Some(l) = lender {
                self.change_active_count(l, -1);
            }
            true
        }

        fn assert_all_invariants(&self) {
            for loan in &self.loans {
                let owed = loan.total_owed();
                let rem = loan.remaining();

                assert!(
                    owed >= loan.amount,
                    "total_owed {} < principal {} (id={}, rate={})",
                    owed,
                    loan.amount,
                    loan.id,
                    loan.interest_rate_bps
                );
                assert!(
                    rem >= 0,
                    "remaining {} is negative (id={})",
                    rem,
                    loan.id
                );
                assert!(
                    loan.repaid_amount >= 0,
                    "repaid_amount {} is negative (id={})",
                    loan.repaid_amount,
                    loan.id
                );
                assert!(
                    loan.repaid_amount <= owed,
                    "repaid_amount {} > total_owed {} (id={})",
                    loan.repaid_amount,
                    owed,
                    loan.id
                );

                match loan.status {
                    SimStatus::Pending => {
                        assert!(
                            loan.lender.is_none(),
                            "PENDING loan {} has lender",
                            loan.id
                        );
                        assert_eq!(
                            loan.repaid_amount, 0,
                            "PENDING loan {} has repayments",
                            loan.id
                        );
                    }
                    SimStatus::Active => {
                        assert!(
                            loan.lender.is_some(),
                            "ACTIVE loan {} missing lender",
                            loan.id
                        );
                        assert!(
                            loan.due_ts > 0,
                            "ACTIVE loan {} missing due_ts",
                            loan.id
                        );
                    }
                    SimStatus::Repaid => {
                        assert_eq!(
                            rem, 0,
                            "REPAID loan {} still has remaining {}",
                            loan.id, rem
                        );
                        assert!(
                            loan.lender.is_some(),
                            "REPAID loan {} missing lender",
                            loan.id
                        );
                    }
                    SimStatus::Cancelled => {
                        assert_eq!(
                            loan.repaid_amount, 0,
                            "CANCELLED loan {} has repayments",
                            loan.id
                        );
                    }
                    SimStatus::Defaulted => {
                        assert!(
                            loan.lender.is_some(),
                            "DEFAULTED loan {} missing lender",
                            loan.id
                        );
                    }
                }
            }

            // MAX_ACTIVE_LOANS never exceeded per member.
            for &(member, count) in &self.active_counts {
                assert!(
                    count <= MAX_ACTIVE_LOANS,
                    "member {} exceeded MAX_ACTIVE_LOANS: {} active",
                    member,
                    count
                );
            }
        }
    }

    // ── Core arithmetic invariants ────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50_000))]

        /// Invariant: total_owed = principal + interest; always ≥ principal.
        #[test]
        fn prop_loan_total_owed_ge_principal(
            principal in 1i128..=i128::MAX / 10_000,
            rate_bps in 0u32..=MAX_INTEREST_RATE_BPS,
        ) {
            let owed = total_owed(principal, rate_bps);
            prop_assert!(owed >= principal,
                "total_owed {} < principal {} at rate_bps={}", owed, principal, rate_bps);
        }

        /// Invariant: zero rate means total_owed == principal.
        #[test]
        fn prop_zero_rate_owed_equals_principal(
            principal in 1i128..=i128::MAX / 10_000,
        ) {
            prop_assert_eq!(total_owed(principal, 0), principal);
        }

        /// Invariant: remaining = total_owed − repaid; never negative.
        #[test]
        fn prop_remaining_never_negative(
            principal in 1i128..=i128::MAX / 10_000,
            rate_bps in 0u32..=MAX_INTEREST_RATE_BPS,
            repaid_ratio in 0.0f64..=1.0f64,
        ) {
            let owed = total_owed(principal, rate_bps);
            let repaid = (owed as f64 * repaid_ratio) as i128;
            let rem = remaining(principal, rate_bps, repaid.min(owed));
            prop_assert!(rem >= 0, "remaining {} is negative", rem);
        }

        /// Invariant: full repayment leaves remaining == 0.
        #[test]
        fn prop_full_repayment_zero_remaining(
            principal in 1i128..=i128::MAX / 10_000,
            rate_bps in 0u32..=MAX_INTEREST_RATE_BPS,
        ) {
            let owed = total_owed(principal, rate_bps);
            prop_assert_eq!(remaining(principal, rate_bps, owed), 0);
        }

        /// Invariant: interest is non-decreasing with rate_bps.
        #[test]
        fn prop_interest_monotone_in_rate(
            principal in 1i128..=i128::MAX / 10_000,
            low_rate in 0u32..=4999u32,
            high_offset in 1u32..=5000u32,
        ) {
            let high_rate = (low_rate + high_offset).min(MAX_INTEREST_RATE_BPS);
            let low_owed = total_owed(principal, low_rate);
            let high_owed = total_owed(principal, high_rate);
            prop_assert!(high_owed >= low_owed,
                "interest not monotone: {} → {} at rate {}→{}",
                low_owed, high_owed, low_rate, high_rate);
        }

        /// Boundary: overflow-safe with amounts near i128::MAX / 10_000.
        #[test]
        fn prop_interest_no_overflow(
            principal in prop::sample::select(std_vec![
                1i128,
                1_000i128,
                1_000_000_0000000i128,
                i128::MAX / 10_001,
                i128::MAX / 10_000,
            ]),
            rate_bps in prop::sample::select(std_vec![
                0u32, 1u32, 100u32, 1000u32, MAX_INTEREST_RATE_BPS
            ]),
        ) {
            let owed = total_owed(principal, rate_bps);
            prop_assert!(owed >= principal, "overflow: owed {} < principal {}", owed, principal);
            prop_assert!(owed >= 0, "owed negative: {}", owed);
        }
    }

    // ── State-machine / multi-call fuzz ───────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2_000))]

        /// Multi-call fuzz: random create/accept/repay/cancel sequences must never
        /// panic or break any invariant for thousands of iterations.
        #[test]
        fn prop_microloan_multicall_invariants(
            member_count in 2u32..=10u32,
            operations in prop::collection::vec(
                (0u32..=4u32, 0u32..=9u32, 1i128..=1_000_000i128, 0u32..=5000u32, 1u64..=365u64),
                1..=30
            ),
        ) {
            let members: StdVec<u32> = (0..member_count).collect();
            let mut sim = MicroloanSim::new();
            let mut created_ids: StdVec<u32> = StdVec::new();
            let mut now_ts = 1_000_000u64; // epoch start

            for (op, member_offset, amount, rate_bps, term_days) in operations {
                let borrower = member_offset % member_count;
                let lender   = ((member_offset + 1) % member_count).max(0);

                match op {
                    0 => {
                        // Create loan request
                        let rate = rate_bps % (MAX_INTEREST_RATE_BPS + 1);
                        if let Some(id) = sim.create_loan(borrower, amount, rate, term_days, &members) {
                            created_ids.push(id);
                        }
                    }
                    1 => {
                        // Accept a loan
                        if let Some(&id) = created_ids.last() {
                            sim.accept_loan(id, lender, now_ts, &members);
                        }
                    }
                    2 => {
                        // Partial repay on a random loan
                        if !created_ids.is_empty() {
                            let idx = (member_offset as usize) % created_ids.len();
                            let id = created_ids[idx];
                            if let Some(loan) = sim.loans.iter().find(|l| l.id == id) {
                                let rem = loan.remaining();
                                let repay = amount.min(rem);
                                if repay > 0 {
                                    sim.repay_loan(id, repay);
                                }
                            }
                        }
                    }
                    3 => {
                        // Cancel a pending loan
                        if !created_ids.is_empty() {
                            let idx = (member_offset as usize) % created_ids.len();
                            sim.cancel_loan(created_ids[idx]);
                        }
                    }
                    4 => {
                        // Advance time and attempt default
                        now_ts = now_ts.saturating_add(term_days * 86_400 + 1);
                        if !created_ids.is_empty() {
                            let idx = (member_offset as usize) % created_ids.len();
                            sim.default_loan(created_ids[idx], now_ts);
                        }
                    }
                    _ => {}
                }

                sim.assert_all_invariants();
            }
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(5_000))]

        /// Invariant: MAX_ACTIVE_LOANS (3) is always respected per member.
        #[test]
        fn prop_max_active_loans_per_member(
            create_attempts in 4u32..=20u32,
            principal in 1i128..=1_000_000i128,
        ) {
            let members = std_vec![0u32, 1u32, 2u32, 3u32];
            let mut sim = MicroloanSim::new();

            // All requests from member 0 as borrower.
            for _ in 0..create_attempts {
                sim.create_loan(0, principal, 500, 30, &members);
            }

            // Accept them all with member 1 as lender.
            let ids: StdVec<u32> = sim
                .loans
                .iter()
                .filter(|l| l.status == SimStatus::Pending)
                .map(|l| l.id)
                .collect();

            for id in ids {
                sim.accept_loan(id, 1, 0, &members);
            }

            // Check that active count never exceeded MAX.
            for loan in &sim.loans {
                if loan.status == SimStatus::Active {
                    let b_count = sim.active_count(loan.borrower);
                    prop_assert!(b_count <= MAX_ACTIVE_LOANS,
                        "borrower {} has {} active loans (max {})",
                        loan.borrower, b_count, MAX_ACTIVE_LOANS);
                    if let Some(l) = loan.lender {
                        let l_count = sim.active_count(l);
                        prop_assert!(l_count <= MAX_ACTIVE_LOANS,
                            "lender {} has {} active loans (max {})",
                            l, l_count, MAX_ACTIVE_LOANS);
                    }
                }
            }
        }

        /// Invariant: repaying more than remaining is always rejected.
        #[test]
        fn prop_no_overpayment(
            principal in 1i128..=1_000_000i128,
            rate_bps in 0u32..=MAX_INTEREST_RATE_BPS,
            excess in 1i128..=1_000_000i128,
        ) {
            let members = std_vec![0u32, 1u32];
            let mut sim = MicroloanSim::new();
            let id = sim.create_loan(0, principal, rate_bps, 30, &members).unwrap();
            sim.accept_loan(id, 1, 0, &members);

            let owed = total_owed(principal, rate_bps);
            let over_repay = owed + excess;

            // Attempt over-payment — must be rejected.
            let result = sim.repay_loan(id, over_repay);
            prop_assert!(!result, "over-repayment should be rejected");

            // Loan must still be ACTIVE.
            let loan = sim.loans.iter().find(|l| l.id == id).unwrap();
            prop_assert_eq!(loan.status, SimStatus::Active);
            prop_assert_eq!(loan.repaid_amount, 0);
        }

        /// Invariant: Cancelled loan can never be accepted or repaid.
        #[test]
        fn prop_cancelled_is_terminal(
            principal in 1i128..=1_000_000i128,
        ) {
            let members = std_vec![0u32, 1u32];
            let mut sim = MicroloanSim::new();
            let id = sim.create_loan(0, principal, 500, 30, &members).unwrap();
            assert!(sim.cancel_loan(id));

            // accept and repay must both be rejected
            let accepted = sim.accept_loan(id, 1, 0, &members);
            prop_assert!(!accepted, "cancelled loan should not be acceptable");

            let repaid = sim.repay_loan(id, 1);
            prop_assert!(!repaid, "cancelled loan should not be repayable");

            let loan = sim.loans.iter().find(|l| l.id == id).unwrap();
            prop_assert_eq!(loan.status, SimStatus::Cancelled);
            prop_assert_eq!(loan.repaid_amount, 0);
        }

        /// Invariant: Repaid loan can never be repaid again (double-repay blocked).
        #[test]
        fn prop_no_double_repay(
            principal in 1i128..=1_000_000i128,
            rate_bps in 0u32..=MAX_INTEREST_RATE_BPS,
        ) {
            let members = std_vec![0u32, 1u32];
            let mut sim = MicroloanSim::new();
            let id = sim.create_loan(0, principal, rate_bps, 30, &members).unwrap();
            sim.accept_loan(id, 1, 0, &members);

            let owed = total_owed(principal, rate_bps);
            assert!(sim.repay_loan(id, owed));

            // Loan now REPAID — second repay must be rejected.
            let second = sim.repay_loan(id, 1);
            prop_assert!(!second, "double-repay should be rejected");

            let loan = sim.loans.iter().find(|l| l.id == id).unwrap();
            prop_assert_eq!(loan.status, SimStatus::Repaid);
            prop_assert_eq!(loan.remaining(), 0);
        }
    }
}
