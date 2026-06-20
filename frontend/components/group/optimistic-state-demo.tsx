"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useOptimisticTransactions } from "@/hooks/useOptimisticTransactions";

interface OptimisticStateDemoProps {
  poolAddress: string;
  showDebug?: boolean;
}

/**
 * Debug component to visualize optimistic transaction state.
 * Only renders when explicitly enabled.
 */
export function OptimisticStateDemo({
  poolAddress,
  showDebug = false,
}: OptimisticStateDemoProps) {
  const { optimisticState, pendingTransactions } =
    useOptimisticTransactions(poolAddress);
  const { pendingTx } = optimisticState;

  if (!showDebug) return null;

  return (
    <Card className="p-4 bg-slate-900/50 border-slate-700/50 mb-4">
      <h4 className="text-sm font-mono text-slate-300 mb-3">
        Optimistic State (DEBUG)
      </h4>

      {!pendingTx ? (
        <p className="text-xs text-slate-500">No pending transactions</p>
      ) : (
        <div className="space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded">
            <span className="text-slate-400">Type:</span>
            <Badge variant="outline">{pendingTx.type}</Badge>
          </div>

          <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded">
            <span className="text-slate-400">Status:</span>
            <div className="flex items-center gap-2">
              {pendingTx.status === "pending" && (
                <>
                  <Clock className="h-3 w-3 animate-spin text-yellow-400" />
                  <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/50 border">
                    pending
                  </Badge>
                </>
              )}
              {pendingTx.status === "confirmed" && (
                <>
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                  <Badge className="bg-green-500/20 text-green-300 border-green-500/50 border">
                    confirmed
                  </Badge>
                </>
              )}
              {pendingTx.status === "failed" && (
                <>
                  <AlertCircle className="h-3 w-3 text-red-400" />
                  <Badge className="bg-red-500/20 text-red-300 border-red-500/50 border">
                    failed
                  </Badge>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded">
            <span className="text-slate-400">TX Hash:</span>
            <span className="text-slate-300 font-bold">
              {pendingTx.txHash
                ? `${pendingTx.txHash.slice(0, 8)}...`
                : "waiting"}
            </span>
          </div>

          <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded">
            <span className="text-slate-400">Amount:</span>
            <span className="text-slate-300">
              {pendingTx.amount
                ? (Number(pendingTx.amount) / 10_000_000).toFixed(2)
                : "-"}{" "}
              XLM
            </span>
          </div>

          {pendingTx.error && (
            <div className="p-2 bg-red-900/20 border border-red-500/50 rounded text-red-300 text-xs">
              <strong>Error:</strong> {pendingTx.error}
            </div>
          )}

          <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded text-slate-400 text-xs">
            <span>Timestamp:</span>
            <span>{new Date(pendingTx.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
      )}

      {pendingTransactions.length > 1 && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 mb-2">
            Other pending: {pendingTransactions.length - 1}
          </p>
          {pendingTransactions.map((tx, i) => (
            <div key={tx.id} className="text-xs text-slate-400 py-1">
              {i + 1}. {tx.type} — {tx.status}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
