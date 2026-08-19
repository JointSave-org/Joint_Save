import { NextResponse } from "next/server"

export const CACHE_CONTROL = {
  PUBLIC_READONLY: "public, s-maxage=60, stale-while-revalidate=300",
  PRIVATE_USER: "private, no-cache",
  STATIC_IMMUTABLE: "public, max-age=31536000, immutable",
} as const

/**
 * Returns a JSON NextResponse with Cache-Control header configured for public, read-only endpoints.
 */
export function jsonPublic<T>(data: T, init?: ResponseInit): NextResponse<T> {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", CACHE_CONTROL.PUBLIC_READONLY)
  return NextResponse.json(data, { ...init, headers })
}

/**
 * Returns a JSON NextResponse with Cache-Control header configured for private, user-specific endpoints.
 */
export function jsonPrivate<T>(data: T, init?: ResponseInit): NextResponse<T> {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", CACHE_CONTROL.PRIVATE_USER)
  return NextResponse.json(data, { ...init, headers })
}
