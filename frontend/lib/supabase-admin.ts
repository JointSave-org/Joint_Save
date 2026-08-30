import { createClient } from "@supabase/supabase-js"
import type { Database } from "./supabase"

// Server-only client that bypasses RLS via the service-role key.
// Never import this file from client components.
export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing Supabase service-role env vars")
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}
