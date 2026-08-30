/**
 * Server-side read-only enforcement for archived pools (issue #212).
 *
 * Hiding the deposit/withdraw/pause buttons is presentation. This is the part
 * that actually holds: any write aimed at an archived pool is refused at the
 * API boundary, so a stale tab, a bookmarked request, or a direct curl cannot
 * mutate a pool that has left discovery.
 *
 * Server-only — it uses the service-role client and must never be imported
 * from a client component.
 */

import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import type { ArchiveReason } from "@/lib/archival"

export interface ArchivedPoolState {
  archived_at: string | null
  archive_reason: ArchiveReason | null
}

/**
 * Look up a pool's archival state. Returns null when the pool does not exist
 * or the lookup fails — callers decide whether a missing pool is fatal, since
 * some of them already 404 on their own.
 */
export async function getArchivalState(poolId: string): Promise<ArchivedPoolState | null> {
  if (!poolId) return null
  const admin = getAdminClient()
  const { data, error } = await admin
    .from("pools")
    .select("archived_at, archive_reason")
    .eq("id", poolId)
    .maybeSingle()

  if (error || !data) return null
  return data as ArchivedPoolState
}

/**
 * Returns a 409 response when the pool is archived, or null when the write may
 * proceed. Fails open on a lookup miss so an unrelated database hiccup does not
 * block writes to healthy pools — archival is a visibility concern, not a
 * security boundary, and the pool's own handler still validates the rest.
 */
export async function blockIfArchived(poolId: string): Promise<NextResponse | null> {
  const state = await getArchivalState(poolId)
  if (!state?.archived_at) return null

  return NextResponse.json(
    {
      error: "This pool has been archived and is no longer active",
      archived: true,
      archived_at: state.archived_at,
      archive_reason: state.archive_reason,
    },
    { status: 409 }
  )
}
