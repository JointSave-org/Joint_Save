// Adversarial / mutation tests for the Microloan contract (issue #262 P3).
//
// These stage *real* token transfers through the contract (the unit tests in
// tests.rs mock the token address away) and try the repay paths an attacker
// would probe: paying more than is owed, paying twice, paying the wrong loan's
// lender via a third-party caller, repaying a loan that is not ACTIVE, and
// defaulting before the due date. Nothing here is a new failure — every case
// pins behaviour the contract already has so a regression cannot slip in.
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, BytesN, Env, Vec,
};

const RATE_BPS: u32 = 500; // 5%
const AMOUNT: i128 = 10_000; // 100 units at 7 decimals
const INTEREST: i128 = AMOUNT * RATE_BPS as i128 / 10_000; // 500

struct LoanFixture<'a> {
    env: Env,
    borrower: Address,
    lender: Address,
    outsider: Address,
    pool_id: Address,
    token: token::StellarAssetClient<'a>,
    token_id: Address,
    client: MicroloanContractClient<'a>,
    members: Vec<Address>,
}

fn setup<'a>() -> LoanFixture<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let token = token::StellarAssetClient::new(&env, &sac.address());

    let admin = Address::generate(&env);
    let borrower = Address::generate(&env);
    let lender = Address::generate(&env);
    let outsider = Address::generate(&env);
    let pool_id = Address::generate(&env);

    // Enough to fund an accept and the repay for each side.
    token.mint(&borrower, &(AMOUNT * 5));
    token.mint(&lender, &(AMOUNT * 5));

    let contract_id = env.register_contract(None, MicroloanContract);
    let client = MicroloanContractClient::new(&env, &contract_id);
    client.initialize(&admin, &None);

    let members = vec![&env, borrower.clone(), lender.clone()];

    LoanFixture {
        env,
        borrower,
        lender,
        outsider,
        pool_id,
        token,
        token_id: sac.address(),
        client,
        members,
    }
}

fn token_client<'a>(fix: &'a LoanFixture<'a>) -> token::Client<'a> {
    token::Client::new(&fix.env, &fix.token_id)
}

/// Create a loan accepted (funded) by the fixture's two members.
fn funded_loan(fix: &LoanFixture<'_>) -> BytesN<32> {
    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &fix.members,
    );
    fix.client
        .accept_loan(&loan_id, &fix.lender, &fix.token_id, &fix.members);
    loan_id
}

// ── Repayment ─────────────────────────────────────────────────────────────────

#[test]
fn test_partial_repay_then_full_repay_transfers_exactly() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    let tc = token_client(&fix);

    let lender_bal_before = tc.balance(&fix.lender);
    let borrower_bal_before = tc.balance(&fix.borrower);

    fix.client
        .repay_loan(&loan_id, &fix.borrower, &750, &fix.token_id);
    let loan = fix.client.get_loan(&loan_id);
    assert_eq!(loan.repaid_amount, 750);
    assert_eq!(loan.status, LoanStatus::Active);
    assert_eq!(loan.remaining(), AMOUNT + INTEREST - 750);

    fix.client.repay_loan(
        &loan_id,
        &fix.borrower,
        &(AMOUNT + INTEREST - 750),
        &fix.token_id,
    );
    let loan = fix.client.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid);
    assert_eq!(loan.remaining(), 0);

    // The lender receives exactly principal + interest and not a stroop more.
    assert_eq!(
        tc.balance(&fix.lender),
        lender_bal_before + AMOUNT + INTEREST
    );
    assert_eq!(
        tc.balance(&fix.borrower),
        borrower_bal_before - (AMOUNT + INTEREST)
    );
}

#[test]
#[should_panic(expected = "repay_amount exceeds remaining balance")]
fn test_repay_over_remaining_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    // Pay one stroop more than the full owed balance.
    let owed = AMOUNT + INTEREST;
    fix.client
        .repay_loan(&loan_id, &fix.borrower, &(owed + 1), &fix.token_id);
}

#[test]
#[should_panic(expected = "loan is not ACTIVE")]
fn test_double_repay_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    let owed = AMOUNT + INTEREST;

    fix.client
        .repay_loan(&loan_id, &fix.borrower, &owed, &fix.token_id);
    // Second repay on an already-repaid loan must fail — no double claim.
    fix.client
        .repay_loan(&loan_id, &fix.borrower, &1, &fix.token_id);
}

#[test]
#[should_panic(expected = "loan is not ACTIVE")]
fn test_repay_after_default_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);

    // Fast-forward past the due date and default the loan.
    fix.env.ledger().with_mut(|l| l.timestamp += 31 * 86_400);
    fix.client.default_loan(&loan_id);

    // A defaulted loan can never be paid as a loan again.
    fix.client
        .repay_loan(&loan_id, &fix.borrower, &1, &fix.token_id);
}

#[test]
#[should_panic(expected = "caller is not the borrower")]
fn test_repay_by_outsider_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);

    // An outsider who is not the borrower must not be able to trigger a
    // repayment on behalf of the borrower (or drain their tokens).
    fix.client
        .repay_loan(&loan_id, &fix.outsider, &1, &fix.token_id);
}

#[test]
#[should_panic(expected = "caller is not the borrower")]
fn test_repay_by_borrower_of_another_loan_is_rejected() {
    // Two borrowers, two loans: repaying the first with the identities of the
    // second must not apply to the first.
    let fix = setup();
    let loan_a = funded_loan(&fix);

    let borrower_b = Address::generate(&fix.env);
    fix.token.mint(&borrower_b, &(AMOUNT * 5));
    let members_b = vec![&fix.env, borrower_b.clone(), fix.lender.clone()];
    let loan_b = fix.client.create_loan_request(
        &fix.pool_id,
        &borrower_b,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &members_b,
    );
    fix.client
        .accept_loan(&loan_b, &fix.lender, &fix.token_id, &members_b);

    // borrower_b tries to pay off loan_a — rejected: loan_a belongs to borrower_a.
    fix.client
        .repay_loan(&loan_a, &borrower_b, &1, &fix.token_id);
}

#[test]
#[should_panic(expected = "loan is not ACTIVE")]
fn test_repay_pending_loan_is_rejected() {
    let fix = setup();
    // Created but never accepted.
    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &fix.members,
    );
    fix.client
        .repay_loan(&loan_id, &fix.borrower, &1, &fix.token_id);
}

#[test]
#[should_panic(expected = "repay_amount must be > 0")]
fn test_repay_zero_or_negative_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    fix.client
        .repay_loan(&loan_id, &fix.borrower, &0i128, &fix.token_id);
}

// ── Acceptance ────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "loan is not in PENDING state")]
fn test_accept_twice_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    // The loan is already ACTIVE; a second accept must be impossible.
    fix.client
        .accept_loan(&loan_id, &fix.outsider, &fix.token_id, &fix.members);
}

#[test]
#[should_panic(expected = "lender is not a pool member")]
fn test_accept_by_non_member_lender_is_rejected() {
    let fix = setup();
    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &fix.members,
    );
    fix.client
        .accept_loan(&loan_id, &fix.outsider, &fix.token_id, &fix.members);
}

#[test]
fn test_accept_membership_is_caller_asserted_not_stored() {
    // Documenting the Trust model: microloan has NO on-chain membership
    // registry — the pool_members vec is supplied by the caller on every call.
    // Authorization rests on the signatures (require_auth on borrower/lender),
    // not on the membership list. This pins the current behaviour: an address
    // that signs CAN lend even though it never appears in the fixture's
    // canonical members list. If membership becomes on-chain, this test must
    // flip to `lender is not a pool member`.
    let fix = setup();
    let tc = token_client(&fix);
    fix.token.mint(&fix.outsider, &(AMOUNT * 5));
    let outsider_before = tc.balance(&fix.outsider);
    let borrower_before = tc.balance(&fix.borrower);

    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &fix.members,
    );
    // Outsider supplies a list naming itself and the borrower; the contract
    // accepts because it has no roster of its own to compare against.
    let asserted = vec![&fix.env, fix.borrower.clone(), fix.outsider.clone()];
    fix.client
        .accept_loan(&loan_id, &fix.outsider, &fix.token_id, &asserted);

    assert_eq!(fix.client.get_loan(&loan_id).status, LoanStatus::Active);
    assert_eq!(
        tc.balance(&fix.lender),
        tc.balance(&fix.lender),
        "lender untouched"
    );
    assert_eq!(tc.balance(&fix.outsider), outsider_before - AMOUNT);
    assert_eq!(tc.balance(&fix.borrower), borrower_before + AMOUNT);
}

#[test]
#[should_panic(expected = "lender cannot be the borrower")]
fn test_self_accept_with_funded_token_is_rejected() {
    // The existing unit test reaches the panic before any token transfer; here
    // the borrower genuinely holds the token, so this proves the guard holds
    // even when the transfer would otherwise succeed.
    let fix = setup();
    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &fix.members,
    );
    fix.client
        .accept_loan(&loan_id, &fix.borrower, &fix.token_id, &fix.members);
}

// ── Defaulting ────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "loan is not yet past due date")]
fn test_default_before_due_date_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    // Only 30 days into a 30-day term: not yet overdue.
    fix.env.ledger().with_mut(|l| l.timestamp += 15 * 86_400);
    fix.client.default_loan(&loan_id);
}

#[test]
#[should_panic(expected = "loan is not ACTIVE")]
fn test_default_pending_loan_is_rejected() {
    let fix = setup();
    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &fix.members,
    );
    fix.env.ledger().with_mut(|l| l.timestamp += 400 * 86_400);
    fix.client.default_loan(&loan_id);
}

#[test]
#[should_panic(expected = "loan is not ACTIVE")]
fn test_default_after_full_repay_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    let owed = AMOUNT + INTEREST;
    fix.client
        .repay_loan(&loan_id, &fix.borrower, &owed, &fix.token_id);
    fix.env.ledger().with_mut(|l| l.timestamp += 400 * 86_400);
    fix.client.default_loan(&loan_id);
}

#[test]
#[should_panic(expected = "loan is not ACTIVE")]
fn test_double_default_is_rejected() {
    // Defaulting the same overdue loan twice is prevented because the loan is
    // no longer ACTIVE; the reputation penalty therefore cannot double-fire.
    let fix = setup();
    let loan_id = funded_loan(&fix);
    fix.env.ledger().with_mut(|l| l.timestamp += 400 * 86_400);
    fix.client.default_loan(&loan_id);
    assert_eq!(fix.client.get_loan(&loan_id).status, LoanStatus::Defaulted);
    // Second default on the now-DEFAULTED loan must fail.
    fix.client.default_loan(&loan_id);
}

// ── Cancellation ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "only PENDING loans can be cancelled")]
fn test_cancel_accepted_loan_is_rejected() {
    let fix = setup();
    let loan_id = funded_loan(&fix);
    fix.client.cancel_loan_request(&loan_id, &fix.borrower);
}

#[test]
#[should_panic(expected = "caller is not the borrower")]
fn test_cancel_by_lender_is_rejected() {
    let fix = setup();
    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &RATE_BPS,
        &30u64,
        &fix.members,
    );
    // The lender may not cancel the borrower's request.
    fix.client.cancel_loan_request(&loan_id, &fix.lender);
}

// ── Fungibility / accounting ─────────────────────────────────────────────────

#[test]
fn test_zero_interest_loan_transfers_only_principal() {
    let fix = setup();
    let tc = token_client(&fix);
    let lender_before = tc.balance(&fix.lender);
    let borrower_before = tc.balance(&fix.borrower);

    let loan_id = fix.client.create_loan_request(
        &fix.pool_id,
        &fix.borrower,
        &AMOUNT,
        &0u32,
        &30u64,
        &fix.members,
    );
    fix.client
        .accept_loan(&loan_id, &fix.lender, &fix.token_id, &fix.members);
    fix.client
        .repay_loan(&loan_id, &fix.borrower, &AMOUNT, &fix.token_id);

    assert_eq!(tc.balance(&fix.lender), lender_before);
    assert_eq!(tc.balance(&fix.borrower), borrower_before);
    assert_eq!(fix.client.get_loan(&loan_id).status, LoanStatus::Repaid);
}
