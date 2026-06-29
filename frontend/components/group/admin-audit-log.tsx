"use client"

/**
 * AdminAuditLog
 *
 * Shows the full pool activity log with a consistency-check banner and
 * an Export CSV button.  Only rendered for the pool creator.
 */

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import { buildCsv, downloadCsv } from "@/lib/csv-export"
import type { AuditRow } from "@/app/api/admin/audit-log/route"

interface AdminAuditLogProps {
  groupId: string
  creatorAddress: string
}

export function AdminAuditLog({ groupId, creatorAddress }: AdminAuditLogProps) {
  const { address } = useStellar()

  const isCreator =
    address && creatorAddress && address.toLowerCase() === creatorAddress.toLowerCase()

  const [rows, setRows] = useState<AuditRow[]>([])
  const [inconsistent, setInconsistent] = useState(false)
  const [activityNet, setActivityNet] = useState(0)
  const [recorded, setRecorded] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isCreator) return
    setLoading(true)
    fetch(`/api/admin/audit-log?poolId=${groupId}&callerAddress=${address}`)
      .then((r) => {
        if (r.status === 403) throw new Error("You are not authorized to view this audit log")
        return r.json()
      })
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setRows(data.rows)
        setInconsistent(data.inconsistent)
        setActivityNet(data.activityNet)
        setRecorded(data.recorded)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isCreator, groupId, address])

  if (!isCreator) return null

  const handleExport = () => {
    const headers = [
      "Date",
      "Activity Type",
      "User Address",
      "Amount (XLM)",
      "Tx Hash",
      "Description",
    ]
    const data = rows.map((r) => [
      new Date(r.created_at).toISOString().slice(0, 19).replace("T", " "),
      r.activity_type,
      r.user_address ?? "",
      r.amount != null ? r.amount.toFixed(2) : "",
      r.tx_hash ?? "",
      r.description ?? "",
    ])
    const csv = buildCsv(headers, data)
    downloadCsv(csv, `audit-log-${groupId}-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold">Admin Audit Log</h3>
          <p className="text-xs text-muted-foreground">Visible to pool creator only</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={loading || rows.length === 0}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Consistency banner */}
      {!loading && !error && (
        <div
          className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${
            inconsistent ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
          }`}
        >
          {inconsistent ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span>
            {inconsistent
              ? `Balance inconsistency: activity net ${activityNet.toFixed(2)} XLM ≠ recorded ${recorded.toFixed(2)} XLM`
              : `Balance consistent: ${recorded.toFixed(2)} XLM`}
          </span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No activity recorded.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="divide-y divide-border text-sm">
          {rows.map((r) => (
            <div key={r.id} className="py-3 flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium capitalize">{r.activity_type}</span>
                  {r.amount != null && <Badge variant="secondary">{r.amount.toFixed(2)} XLM</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.user_address
                    ? `${r.user_address.slice(0, 8)}…${r.user_address.slice(-6)}`
                    : "System"}
                </p>
                {r.tx_hash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${r.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    {r.tx_hash.slice(0, 8)}…
                  </a>
                )}
              </div>
              <time className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </time>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
