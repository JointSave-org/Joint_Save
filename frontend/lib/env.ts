const requiredEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_STELLAR_RPC_URL",
  "NEXT_PUBLIC_STELLAR_HORIZON_URL",
  "NEXT_PUBLIC_FACTORY_CONTRACT_ID",
  "NEXT_PUBLIC_TOKEN_CONTRACT_ID",
  "NEXT_PUBLIC_ROTATIONAL_WASM_HASH",
  "NEXT_PUBLIC_TARGET_WASM_HASH",
  "NEXT_PUBLIC_FLEXIBLE_WASM_HASH",
] as const

type RequiredEnvVar = (typeof requiredEnvVars)[number]

function readRequiredEnv(key: RequiredEnvVar): string {
  const value = process.env[key]?.trim()
  if (!value) {
    throw new Error(
      `Missing required env var: ${key}. Copy frontend/.env.example to frontend/.env.local and fill in this value.`,
    )
  }
  return value
}

export const env = {
  NEXT_PUBLIC_SUPABASE_URL: readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  NEXT_PUBLIC_STELLAR_RPC_URL: readRequiredEnv("NEXT_PUBLIC_STELLAR_RPC_URL"),
  NEXT_PUBLIC_STELLAR_HORIZON_URL: readRequiredEnv("NEXT_PUBLIC_STELLAR_HORIZON_URL"),
  NEXT_PUBLIC_FACTORY_CONTRACT_ID: readRequiredEnv("NEXT_PUBLIC_FACTORY_CONTRACT_ID"),
  NEXT_PUBLIC_TOKEN_CONTRACT_ID: readRequiredEnv("NEXT_PUBLIC_TOKEN_CONTRACT_ID"),
  NEXT_PUBLIC_REPUTATION_CONTRACT_ID:
    process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID?.trim() ?? "",
  NEXT_PUBLIC_ROTATIONAL_WASM_HASH: readRequiredEnv("NEXT_PUBLIC_ROTATIONAL_WASM_HASH"),
  NEXT_PUBLIC_TARGET_WASM_HASH: readRequiredEnv("NEXT_PUBLIC_TARGET_WASM_HASH"),
  NEXT_PUBLIC_FLEXIBLE_WASM_HASH: readRequiredEnv("NEXT_PUBLIC_FLEXIBLE_WASM_HASH"),
  NEXT_PUBLIC_DEBUG_DATA_LAYER:
    process.env.NEXT_PUBLIC_DEBUG_DATA_LAYER?.trim() ?? "false",
} as const

export { requiredEnvVars }
