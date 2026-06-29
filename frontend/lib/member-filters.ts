// Pure, client-side helpers for filtering pool members by deposit status.
// They mirror the status the member list already displays (the Clock icon),
// so the filter is just a view over data already on the page — no new fetching.

/** Minimal shape needed to decide pending-ness; keeps helpers decoupled from the full Member type. */
export interface MemberStatusLike {
  status: string
}

/**
 * A member is "pending" (has not deposited yet) when status === "pending".
 * This mirrors the displayed status; `late` is intentionally excluded to match the
 * issue's acceptance criteria ("only pending members"). If product later wants late
 * members included, this predicate is the only line to change.
 */
export function isPendingMember(member: MemberStatusLike): boolean {
  return member.status === "pending"
}

/** Count of members still pending a deposit. */
export function countPendingMembers(members: MemberStatusLike[]): number {
  return members.filter(isPendingMember).length
}

/** Subset of members still pending a deposit, preserving the input element type. */
export function filterPendingMembers<T extends MemberStatusLike>(members: T[]): T[] {
  return members.filter(isPendingMember)
}
