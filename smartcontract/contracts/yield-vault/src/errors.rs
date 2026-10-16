use soroban_sdk::contracterror;

/// Shared error vocabulary for the yield-allocation feature. Adapters return
/// the vault-side variants; the pool returns `BufferViolation` and `Unauthorized`.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientShares = 5,
    Illiquid = 6,
    MathOverflow = 7,
    BufferViolation = 8,
}
