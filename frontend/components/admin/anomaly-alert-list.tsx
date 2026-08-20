"use client"

import { AlertTriangle, Info, AlertCircle, XCircle, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Anomaly } from "@/app/api/admin/pools/route"
import { ScrollArea } from "@/components/ui/scroll-area"

const SEVERITY_CONFIG = {
  critical: {
    icon: XCircle,
    className: "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400",
    iconClassName: "text-rose-500",
  },
  warning: {
    icon: AlertTriangle,
    className: "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400",
    iconClassName: "text-amber-500",
  },
  info: {
    icon: Info,
    className: "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400",
    iconClassName: "text-blue-500",
  },
}

function AnomalyItem({
  anomaly,
  poolName,
  poolId,
}: {
  anomaly: Anomaly
  poolName: string
  poolId: string
}) {
  const config = SEVERITY_CONFIG[anomaly.severity]
  const Icon = config.icon

  return (
    <div className={cn("rounded-lg border p-3 space-y-1.5", config.className)}>
      <div className="flex items-start gap-2">
        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.iconClassName)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{poolName}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-60">
              {anomaly.severity}
            </span>
          </div>
          <p className="text-sm mt-0.5">{anomaly.message}</p>
          <p className="text-xs opacity-70 mt-1">{anomaly.suggestedAction}</p>
        </div>
        <a
          href={`/dashboard/group/${poolId}`}
          className="shrink-0 p-1 rounded-md hover:bg-background/50 transition-colors"
          title="View pool"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}

export function AnomalyAlertList({
  anomalies,
}: {
  anomalies: { poolId: string; poolName: string; anomaly: Anomaly }[]
}) {
  if (anomalies.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No anomalies detected across your pools.</p>
      </div>
    )
  }

  // Sort: critical first, then warning, then info
  const sorted = [...anomalies].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 }
    return order[a.anomaly.severity] - order[b.anomaly.severity]
  })

  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-2 pr-4">
        {sorted.map((item, i) => (
          <AnomalyItem
            key={`${item.poolId}-${item.anomaly.type}-${i}`}
            anomaly={item.anomaly}
            poolName={item.poolName}
            poolId={item.poolId}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
