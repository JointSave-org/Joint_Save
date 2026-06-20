use soroban_sdk::{symbol_short, Env};

pub fn deployed(env: &Env, amount: i128) {
    env.events().publish((symbol_short!("deployed"),), amount);
}

pub fn harvested(env: &Env, yield_amount: i128) {
    env.events().publish((symbol_short!("harvested"),), yield_amount);
}

pub fn emergency_exit(env: &Env, amount: i128) {
    env.events().publish((symbol_short!("emg_exit"),), amount);
}
