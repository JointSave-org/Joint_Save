/// Fixed-point scale for share prices. A `share_price` of `SHARE_SCALE` means
/// one underlying-asset unit per share. All vault math stays in integers.
pub const SHARE_SCALE: i128 = 1_000_000_000;

/// Default liquidity buffer: 20% of the pot (2000 basis points) always stays
/// liquid so ordinary member withdrawals keep working.
pub const DEFAULT_BUFFER_BPS: u32 = 2000;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u32 = 10_000;
