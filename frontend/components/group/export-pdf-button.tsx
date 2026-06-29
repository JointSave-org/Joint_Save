"use client"

/**
 * ExportPdfButton
 * Renders only for the pool creator/admin. Fetches the full pool record
 * (including members + activity) from the API and generates a client-side
 * PDF summary using jsPDF.
 *
 * Props:
 *   groupId         – Supabase pool UUID
 *   creatorAddress  – pool.creator_address from the already-loaded pool record
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FileDown, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { useStellar } from "@/components/web3-provider"

interface ExportPdfButtonProps {
  groupId: string
  /** The pool's creator_address as stored in Supabase */
  creatorAddress: string
}

export function ExportPdfButton({ groupId, creatorAddress }: ExportPdfButtonProps) {
  const { address } = useStellar()
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle")
  const [errMsg, setErrMsg] = useState("")

  // ── Guard: only the creator sees this button ────────────────────────────────
  const isCreator =
    address && creatorAddress && address.toLowerCase() === creatorAddress.toLowerCase()

  if (!isCreator) return null

  // ── Handler ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setLoading(true)
    setStatus("idle")
    setErrMsg("")

    try {
      // Dynamically import the generator so jsPDF is never loaded unless needed
      const [{ generatePoolPdf }, res] = await Promise.all([
        import("@/lib/generate-pool-pdf"),
        fetch(`/api/pools?id=${groupId}`),
      ])

      if (!res.ok) throw new Error("Failed to fetch pool data")
      const pool = await res.json()

      // Normalize: ensure arrays exist even if the DB returns null
      pool.pool_members = pool.pool_members ?? []
      pool.pool_activity = pool.pool_activity ?? []

      generatePoolPdf(pool)
      setStatus("ok")
      setTimeout(() => setStatus("idle"), 3000)
    } catch (err: unknown) {
      setErrMsg((err as Error).message ?? "PDF generation failed")
      setStatus("err")
      setTimeout(() => setStatus("idle"), 5000)
    } finally {
      setLoading(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={loading}
        className="w-full gap-2 border-primary/40 text-primary hover:bg-primary/10 hover:border-primary transition-all"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating PDF…
          </>
        ) : status === "ok" ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Downloaded!
          </>
        ) : status === "err" ? (
          <>
            <AlertCircle className="h-4 w-4 text-destructive" />
            Export Failed
          </>
        ) : (
          <>
            <FileDown className="h-4 w-4" />
            Export Summary (PDF)
          </>
        )}
      </Button>

      {status === "err" && errMsg && <p className="text-xs text-destructive px-1">{errMsg}</p>}

      {status === "idle" && !loading && (
        <p className="text-xs text-muted-foreground px-1">
          Admin only · Includes full activity log
        </p>
      )}
    </div>
  )
}
