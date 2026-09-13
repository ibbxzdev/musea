#![no_std]

//! # TipJar
//!
//! Moves USDC from a tipper to a curator and keeps an on-chain running total per gallery
//! and per curator. The totals are the point: they make curator support publicly
//! verifiable rather than a number our own database asserts.
//!
//! Design decisions worth knowing before you change anything here:
//!
//! - **The USDC SAC address is set once, at construction, and is never a call parameter.**
//!   If callers could pass the token address, anyone could invoke `tip` with a worthless
//!   token they control and inflate a gallery's total for free. Fixing it at construction
//!   is the allowlist.
//!
//! - **Amounts are `i128` in stroops** (1 USDC = 10_000_000). The client converts; this
//!   contract never sees a decimal.
//!
//! - **`from` must be the transaction source** in our flow, so the source signature
//!   satisfies both this contract's `require_auth` and the SAC transfer's inner one,
//!   with no separate authorization entry to assemble.
//!
//! - **`checked_add` on every total.** An overflow that silently wraps would make a
//!   gallery's headline number wrong forever; persistent storage has no undo.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    InvalidAmount = 2,
    SelfTip = 3,
    Overflow = 4,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Address of the USDC SAC. Set at construction, read-only thereafter.
    Usdc,
    /// Running total tipped to a gallery, keyed by sha256(convex gallery id).
    GalleryTotal(BytesN<32>),
    /// Running total received by a curator.
    CuratorTotal(Address),
}

#[contractevent(topics = ["tip"])]
pub struct TipEvent {
    pub from: Address,
    pub to: Address,
    pub gallery: BytesN<32>,
    pub amount: i128,
}

/// ~30 days of ledgers. Persistent entries are bumped on every write so an actively
/// tipped gallery never expires; a dormant one can be restored rather than lost.
const TTL_THRESHOLD: u32 = 100;
const TTL_EXTEND_TO: u32 = 518_400;

#[contract]
pub struct TipJar;

#[contractimpl]
impl TipJar {
    /// Runs once at deploy time. `usdc` is the USDC SAC contract address.
    pub fn __constructor(env: Env, usdc: Address) {
        env.storage().instance().set(&DataKey::Usdc, &usdc);
    }

    /// Tip `amount` stroops of USDC from `from` to `to`, attributed to `gallery`.
    pub fn tip(
        env: Env,
        from: Address,
        to: Address,
        gallery: BytesN<32>,
        amount: i128,
    ) -> Result<(), Error> {
        from.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if from == to {
            return Err(Error::SelfTip);
        }

        let usdc: Address = env
            .storage()
            .instance()
            .get(&DataKey::Usdc)
            .ok_or(Error::NotInitialized)?;

        // Move the money first. If this traps (insufficient balance, no trustline), the
        // whole invocation reverts and no total is recorded — totals can never describe
        // a transfer that did not happen.
        token::Client::new(&env, &usdc).transfer(&from, &to, &amount);

        let g_key = DataKey::GalleryTotal(gallery.clone());
        let g_total: i128 = env.storage().persistent().get(&g_key).unwrap_or(0);
        let g_new = g_total.checked_add(amount).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&g_key, &g_new);
        env.storage()
            .persistent()
            .extend_ttl(&g_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        let c_key = DataKey::CuratorTotal(to.clone());
        let c_total: i128 = env.storage().persistent().get(&c_key).unwrap_or(0);
        let c_new = c_total.checked_add(amount).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&c_key, &c_new);
        env.storage()
            .persistent()
            .extend_ttl(&c_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        TipEvent {
            from,
            to,
            gallery,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Total tipped to a gallery, in stroops.
    pub fn gallery_total(env: Env, gallery: BytesN<32>) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::GalleryTotal(gallery))
            .unwrap_or(0)
    }

    /// Total a curator has received, in stroops.
    pub fn curator_total(env: Env, curator: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::CuratorTotal(curator))
            .unwrap_or(0)
    }

    /// The USDC SAC this contract is bound to. Exposed so the backend can assert at
    /// startup that it is pointed at the same token it thinks it is.
    pub fn usdc(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Usdc)
            .ok_or(Error::NotInitialized)
    }
}

mod test;
