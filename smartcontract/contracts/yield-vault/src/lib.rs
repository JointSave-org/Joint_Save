#![no_std]

mod adapter;
mod errors;
mod events;
mod types;

pub use adapter::{VaultAdapter, VaultClient};
pub use errors::VaultError;
pub use events::{allocated, buffer_set, deallocated, lock_set, synced};
pub use types::{BPS_DENOMINATOR, DEFAULT_BUFFER_BPS, SHARE_SCALE};
