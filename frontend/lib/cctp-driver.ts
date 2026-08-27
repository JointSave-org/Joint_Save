/**
 * Thin seam adapter between the bridge UI (`frontend/app/[locale]/bridge/page.tsx`)
 * and the network. Keeps wallet/network code out of the page so the
 * attestation state machine and amount logic stay purely testable (see
 * `frontend/lib/cctp-bridge.test.ts`).
 *
 * `fetchAttestation` really queries Circle's Attestation Service. `depositForBurn`
 * is a deterministic stand-in (no EVM wallet kit is connected in this
 * Stellar-only app yet); it derives a stable message hash from the call so the
 * full flow — burn → attestation → deposit hand-off — can be driven and the
 * seam can later be swapped for a real EVM implementation without changing the
 * page.
 */
import { ATTESTATION_SERVICE_URL, type AttestationRawStatus } from "@/lib/cctp-bridge"

export async function fetchAttestation(messageHash: string): Promise<{
  status: AttestationRawStatus
}> {
  const url = `${ATTESTATION_SERVICE_URL}/${encodeURIComponent(messageHash)}`
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" })
  if (!res.ok) {
    // A 404 means the burn was never indexed — treat as still pending.
    if (res.status === 404) return { status: "pending_attestation" }
    throw new Error(`Attestation service returned ${res.status}`)
  }
  const body = (await res.json()) as { status?: string; error?: unknown }
  const raw = String(body.status ?? "").toLowerCase()
  const status: AttestationRawStatus = mapAttestationStatus(raw)
  return { status }
}

/** Map the service's raw status strings to the canonical union. */
export function mapAttestationStatus(raw: string): AttestationRawStatus {
  switch (raw) {
    case "pending_confirmations":
      return "pending_confirmations"
    case "pending_attestation":
      return "pending_attestation"
    case "complete":
      return "complete"
    case "failure":
    case "failed":
      return "failure"
    case "expired":
      return "expired"
    default:
      return "pending_attestation"
  }
}

/**
 * Deterministic stand-in for `depositForBurn`. Returns a stable message hash
 * derived from the call inputs so the seam is reproducible for tests and the
 * UI. Replace with a real `depositForBurn` + `MessageSent`-event capture once
 * an EVM-capable wallet is wired into the app.
 */
export async function depositForBurnSeam(input: {
  sourceChainId: string
  amountBaseUnits: bigint
  recipient: string
  nonce: string
}): Promise<{ messageHash: string; sourceTxHash: string }> {
  const base = `${input.sourceChainId}:${input.amountBaseUnits.toString()}:${input.recipient}:${input.nonce}`
  return {
    messageHash: `0x${sha256hex(base).slice(0, 64)}`,
    sourceTxHash: `0x${sha256hex(`${base}:tx`).slice(0, 64)}`,
  }
}

/** Minimal, dependency-free SHA-256 (FIPS 180-4) for stable message hashes. */
function sha256hex(input: string): string {
  // Convert to a UTF-8 byte buffer.
  const bytes = new TextEncoder().encode(input)

  function rotr(word: number, bits: number): number {
    return (word >>> bits) | (word << (32 - bits))
  }

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]

  const ml = bytes.length * 8
  const withOne = new Uint8Array(bytes.length + 1)
  withOne.set(bytes)
  withOne[bytes.length] = 0x80
  const withLen = new Uint8Array(Math.ceil((withOne.length + 8) / 64) * 64)
  withLen.set(withOne)
  const view = new DataView(withLen.buffer)
  view.setUint32(withLen.length - 8, Math.floor(ml / 0x100000000), false)
  view.setUint32(withLen.length - 4, ml >>> 0, false)

  const words = Array.from({ length: 80 }, () => 0)
  for (let i = 0; i < withLen.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      words[j] = view.getUint32(i + j * 4, false)
    }
    for (let j = 16; j < 80; j++) {
      const s0 = rotr(words[j - 15], 7) ^ rotr(words[j - 15], 18) ^ (words[j - 15] >>> 3)
      const s1 = rotr(words[j - 2], 17) ^ rotr(words[j - 2], 19) ^ (words[j - 2] >>> 10)
      words[j] = (words[j - 16] + s0 + words[j - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let j = 0; j < 80; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[j] + words[j]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0
    H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0
    H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0
    H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0
    H[7] = (H[7] + h) >>> 0
  }

  return H.map((n) => n.toString(16).padStart(8, "0")).join("")
}
