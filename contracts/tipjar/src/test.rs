#![cfg(test)]

//! Unit tests for TipJar.
//!
//! UNVERIFIED: written against the soroban-sdk 27 API but not yet compiled — Rust and the
//! `stellar` CLI were not installed when this repo was scaffolded. Story 1.1 is to install
//! the toolchain and get `cargo test` green; expect some testutils names to need
//! adjusting (`register`, `register_stellar_asset_contract_v2` and friends have drifted
//! between SDK majors). The assertions express the intended behaviour either way.
//!
//! Note that `mock_all_auths` is blunt — it makes every `require_auth` pass, so none of
//! the tests using it can tell you whether authorization is actually wired. That is what
//! `tip_requires_tipper_auth` is for, and it is still a stub.

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Events as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, Event as _, IntoVal,
};

struct Fixture {
    env: Env,
    client: TipJarClient<'static>,
    token: token::Client<'static>,
    token_admin: token::StellarAssetClient<'static>,
    tipper: Address,
    curator: Address,
    gallery: BytesN<32>,
}

const ONE_XLM: i128 = 10_000_000;

fn setup() -> Fixture {
    let env = Env::default();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_admin = token::StellarAssetClient::new(&env, &sac.address());
    let token = token::Client::new(&env, &sac.address());

    let contract_id = env.register(TipJar, (sac.address(),));
    let client = TipJarClient::new(&env, &contract_id);

    Fixture {
        tipper: Address::generate(&env),
        curator: Address::generate(&env),
        gallery: BytesN::random(&env),
        env,
        client,
        token,
        token_admin,
    }
}

#[test]
fn tip_moves_xlm_and_records_totals() {
    let f = setup();
    f.env.mock_all_auths();
    f.token_admin.mint(&f.tipper, &(100 * ONE_XLM));

    f.client
        .tip(&f.tipper, &f.curator, &f.gallery, &(5 * ONE_XLM));

    assert_eq!(f.token.balance(&f.tipper), 95 * ONE_XLM);
    assert_eq!(f.token.balance(&f.curator), 5 * ONE_XLM);
    assert_eq!(f.client.gallery_total(&f.gallery), 5 * ONE_XLM);
    assert_eq!(f.client.curator_total(&f.curator), 5 * ONE_XLM);
}

#[test]
fn totals_accumulate_across_tips_and_tippers() {
    let f = setup();
    f.env.mock_all_auths();

    let tipper2 = Address::generate(&f.env);
    f.token_admin.mint(&f.tipper, &(100 * ONE_XLM));
    f.token_admin.mint(&tipper2, &(100 * ONE_XLM));

    f.client
        .tip(&f.tipper, &f.curator, &f.gallery, &(5 * ONE_XLM));
    f.client
        .tip(&tipper2, &f.curator, &f.gallery, &(10 * ONE_XLM));

    assert_eq!(f.client.gallery_total(&f.gallery), 15 * ONE_XLM);
    assert_eq!(f.client.curator_total(&f.curator), 15 * ONE_XLM);
}

#[test]
fn totals_are_scoped_per_gallery() {
    let f = setup();
    f.env.mock_all_auths();
    f.token_admin.mint(&f.tipper, &(100 * ONE_XLM));

    let other_gallery = BytesN::random(&f.env);
    f.client
        .tip(&f.tipper, &f.curator, &f.gallery, &(5 * ONE_XLM));

    assert_eq!(f.client.gallery_total(&f.gallery), 5 * ONE_XLM);
    assert_eq!(f.client.gallery_total(&other_gallery), 0);
    // The curator's lifetime total spans galleries, though.
    assert_eq!(f.client.curator_total(&f.curator), 5 * ONE_XLM);
}

#[test]
fn rejects_self_tip() {
    let f = setup();
    f.env.mock_all_auths();
    f.token_admin.mint(&f.tipper, &(100 * ONE_XLM));

    let err = f
        .client
        .try_tip(&f.tipper, &f.tipper, &f.gallery, &ONE_XLM)
        .err();
    assert_eq!(err, Some(Ok(Error::SelfTip)));
}

#[test]
fn rejects_zero_and_negative_amounts() {
    let f = setup();
    f.env.mock_all_auths();
    f.token_admin.mint(&f.tipper, &(100 * ONE_XLM));

    assert_eq!(
        f.client
            .try_tip(&f.tipper, &f.curator, &f.gallery, &0)
            .err(),
        Some(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        f.client
            .try_tip(&f.tipper, &f.curator, &f.gallery, &-ONE_XLM)
            .err(),
        Some(Ok(Error::InvalidAmount))
    );
}

#[test]
fn failed_transfer_records_no_total() {
    // The tipper has no XLM at all, so the SAC transfer traps and the whole invocation
    // reverts. The gallery total must not have moved.
    let f = setup();
    f.env.mock_all_auths();

    let result = f
        .client
        .try_tip(&f.tipper, &f.curator, &f.gallery, &ONE_XLM);
    assert!(result.is_err());
    assert_eq!(f.client.gallery_total(&f.gallery), 0);
    assert_eq!(f.client.curator_total(&f.curator), 0);
}

#[test]
fn tip_requires_tipper_auth() {
    // Story 1.2 — the SOW's one genuinely novel step: the in-contract SAC transfer under
    // authorization. Written with `env.mock_auths` and not `mock_all_auths`, because
    // `mock_all_auths` makes every `require_auth` pass and the test would stay green if
    // someone deleted `from.require_auth()`. Deleting that line must break this test.
    let f = setup();

    // Minting needs the issuer's auth; grant everything for setup, then switch to the
    // scoped entries — `mock_auths` replaces recording mode, it does not stack with it.
    f.env.mock_all_auths();
    f.token_admin.mint(&f.tipper, &(100 * ONE_XLM));

    let amount = 5 * ONE_XLM;
    let args: soroban_sdk::Vec<soroban_sdk::Val> = (
        f.tipper.clone(),
        f.curator.clone(),
        f.gallery.clone(),
        amount,
    )
        .into_val(&f.env);
    let transfer_args: soroban_sdk::Vec<soroban_sdk::Val> =
        (f.tipper.clone(), f.curator.clone(), amount).into_val(&f.env);

    let sub = [MockAuthInvoke {
        contract: &f.token.address,
        fn_name: "transfer",
        args: transfer_args,
        sub_invokes: &[],
    }];
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "tip",
        args,
        sub_invokes: &sub,
    };

    // 1. Authorized by the tipper: succeeds, and the money actually moves.
    f.env.mock_auths(&[MockAuth {
        address: &f.tipper,
        invoke: &invoke,
    }]);
    f.client.tip(&f.tipper, &f.curator, &f.gallery, &amount);

    // `env.auths()` is deliberately not asserted here: it only records under
    // `mock_all_auths`, and returns empty in the enforcing mode `mock_auths` puts us in.
    // Case 2 below is what proves authorization is enforced.
    assert_eq!(f.token.balance(&f.tipper), 95 * ONE_XLM);
    assert_eq!(f.token.balance(&f.curator), amount);
    assert_eq!(f.client.gallery_total(&f.gallery), amount);

    // 2. The identical invocation, authorized by somebody else: must be refused. This is
    //    the case that fails if `from.require_auth()` is missing.
    let stranger = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &invoke,
    }]);

    assert!(
        f.client
            .try_tip(&f.tipper, &f.curator, &f.gallery, &amount)
            .is_err(),
        "a tip authorized by an address other than `from` must not move the tipper's XLM"
    );
    assert_eq!(
        f.token.balance(&f.curator),
        amount,
        "the refused tip must not have moved anything"
    );
}

#[test]
fn token_address_is_fixed_at_construction() {
    let f = setup();
    assert_eq!(f.client.token(), f.token.address);
}

#[test]
fn unknown_gallery_reads_zero() {
    let f = setup();
    assert_eq!(f.client.gallery_total(&BytesN::random(&f.env)), 0);
    assert_eq!(f.client.curator_total(&Address::generate(&f.env)), 0);
}

#[test]
fn emits_tip_event() {
    let f = setup();
    f.env.mock_all_auths();
    f.token_admin.mint(&f.tipper, &(100 * ONE_XLM));

    f.client
        .tip(&f.tipper, &f.curator, &f.gallery, &(5 * ONE_XLM));

    // The invocation also emits the SAC's own `transfer` event, so narrow to ours before
    // asserting — otherwise this would pass on the token's event alone.
    let ours = f.env.events().all().filter_by_contract(&f.client.address);
    let expected = TipEvent {
        from: f.tipper.clone(),
        to: f.curator.clone(),
        gallery: f.gallery.clone(),
        amount: 5 * ONE_XLM,
    };
    assert_eq!(
        ours,
        std::vec![expected.to_xdr(&f.env, &f.client.address)],
        "tip should publish exactly one TipEvent, carrying the tip's own fields"
    );
}
