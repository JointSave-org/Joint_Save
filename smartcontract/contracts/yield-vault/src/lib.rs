#![no_std]

pub mod adapter;
mod errors;
mod events;
pub mod mock;
mod types;

pub use adapter::{VaultAdapter, VaultClient};
pub use errors::VaultError;
pub use events::{allocated, buffer_set, deallocated, lock_set, synced};
pub use types::{BPS_DENOMINATOR, DEFAULT_BUFFER_BPS, SHARE_SCALE};

#[cfg(test)]
mod tests;
