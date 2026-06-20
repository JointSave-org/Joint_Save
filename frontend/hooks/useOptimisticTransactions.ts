"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { getRpc } from "./useJointSaveContracts";
import { rpc } from "@stellar/stellar-sdk";

export interface PendingTransaction {
  id: string; // unique identifier (txHash or local ID before submission)
  type: "deposit" | "withdraw" | "trigger_payout";
  poolAddress: string;
  userAddress: string;
  amount?: bigint; // for deposit/withdraw
  timestamp: number;
  txHash?: string; // populated after submission
  status: "pending" | "confirmed" | "failed";
  error?: string;
}

export interface OptimisticUpdate {
  // Pending transaction state
  pendingTx?: PendingTransaction;
  // Computed pending value(s) - what the UI should display optimistically
  optimisticPoolTotal?: bigint; // for deposits
  optimisticUserBalance?: bigint; // for withdrawals
  optimisticNextPayoutRecipient?: string; // for rotational payout
}

type TransactionCallback = (
  status: "pending" | "confirmed" | "failed",
  tx: PendingTransaction,
) => void;

class OptimisticTransactionManager {
  private pendingTransactions = new Map<string, PendingTransaction>();
  private callbacks = new Map<string, Set<TransactionCallback>>();
  private pollIntervals = new Map<string, NodeJS.Timeout>();

  subscribe(txId: string, callback: TransactionCallback): () => void {
    if (!this.callbacks.has(txId)) {
      this.callbacks.set(txId, new Set());
    }
    this.callbacks.get(txId)!.add(callback);
    return () => {
      this.callbacks.get(txId)?.delete(callback);
    };
  }

  private notify(
    txId: string,
    status: "pending" | "confirmed" | "failed",
    tx: PendingTransaction,
  ) {
    this.callbacks.get(txId)?.forEach((cb) => cb(status, tx));
  }

  registerPending(tx: PendingTransaction): void {
    this.pendingTransactions.set(tx.id, tx);
    this.notify(tx.id, "pending", tx);
  }

  setPendingTxHash(txId: string, txHash: string): void {
    const tx = this.pendingTransactions.get(txId);
    if (tx) {
      tx.txHash = txHash;
      tx.status = "pending";
      this.notify(txId, "pending", tx);
      // Start polling for confirmation
      this.pollTransaction(txId);
    }
  }

  getPending(txId: string): PendingTransaction | undefined {
    return this.pendingTransactions.get(txId);
  }

  getAllPending(): PendingTransaction[] {
    return Array.from(this.pendingTransactions.values());
  }

  private async pollTransaction(txId: string, attempt = 0) {
    const tx = this.pendingTransactions.get(txId);
    if (!tx || !tx.txHash || tx.status !== "pending") return;

    try {
      const server = getRpc();
      const result = await server.getTransaction(tx.txHash);

      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        tx.status = "confirmed";
        this.notify(txId, "confirmed", tx);
        this.pendingTransactions.delete(txId);
        return;
      }

      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        tx.status = "failed";
        tx.error = "Transaction failed on-chain";
        this.notify(txId, "failed", tx);
        this.pendingTransactions.delete(txId);
        return;
      }

      // Still not found — retry up to 30 times
      if (attempt < 30) {
        const interval = setTimeout(
          () => this.pollTransaction(txId, attempt + 1),
          1500,
        );
        this.pollIntervals.set(`${txId}-${attempt}`, interval);
      } else {
        tx.status = "failed";
        tx.error = "Transaction confirmation timeout";
        this.notify(txId, "failed", tx);
        this.pendingTransactions.delete(txId);
      }
    } catch (err) {
      tx.status = "failed";
      tx.error = err instanceof Error ? err.message : "Unknown error";
      this.notify(txId, "failed", tx);
      this.pendingTransactions.delete(txId);
    }
  }

  markFailed(txId: string, error: string): void {
    const tx = this.pendingTransactions.get(txId);
    if (tx) {
      tx.status = "failed";
      tx.error = error;
      this.notify(txId, "failed", tx);
      this.pendingTransactions.delete(txId);
    }
  }

  cleanup(): void {
    this.pollIntervals.forEach((interval) => clearTimeout(interval));
    this.pollIntervals.clear();
  }
}

// Singleton instance
const manager = new OptimisticTransactionManager();

/**
 * Hook for managing optimistic transaction UI state.
 *
 * Usage:
 * 1. Before submitting: register pending TX with registerOptimistic()
 * 2. After getting txHash: updateTxHash() to enable polling
 * 3. Hook notifies on confirmation/failure
 * 4. Component reflects optimistic update until confirmed/rolled back
 */
export function useOptimisticTransactions(poolAddress: string) {
  const [optimisticState, setOptimisticState] = useState<OptimisticUpdate>({});
  const txIdRef = useRef<string>("");

  const registerOptimistic = useCallback(
    (
      type: "deposit" | "withdraw" | "trigger_payout",
      userAddress: string,
      amount?: bigint,
    ): PendingTransaction => {
      const txId = `${poolAddress}-${type}-${Date.now()}-${Math.random()}`;
      const tx: PendingTransaction = {
        id: txId,
        type,
        poolAddress,
        userAddress,
        amount,
        timestamp: Date.now(),
        status: "pending",
      };

      manager.registerPending(tx);
      txIdRef.current = txId;

      setOptimisticState({
        pendingTx: tx,
      });

      return tx;
    },
    [poolAddress],
  );

  const updateTxHash = useCallback((txHash: string) => {
    if (!txIdRef.current) return;
    manager.setPendingTxHash(txIdRef.current, txHash);
  }, []);

  const setOptimisticValues = useCallback(
    (values: Omit<OptimisticUpdate, "pendingTx">) => {
      if (!txIdRef.current) return;
      const tx = manager.getPending(txIdRef.current);
      if (tx) {
        setOptimisticState((prev) => ({
          ...prev,
          ...values,
        }));
      }
    },
    [],
  );

  const clearOptimistic = useCallback(() => {
    txIdRef.current = "";
    setOptimisticState({});
  }, []);

  const markFailed = useCallback((error: string) => {
    if (!txIdRef.current) return;
    manager.markFailed(txIdRef.current, error);
    setOptimisticState((prev) => ({
      pendingTx: prev.pendingTx
        ? { ...prev.pendingTx, status: "failed", error }
        : undefined,
    }));
  }, []);

  // Subscribe to tx status changes
  useEffect(() => {
    if (!txIdRef.current) return;
    const unsubscribe = manager.subscribe(txIdRef.current, (status, tx) => {
      setOptimisticState((prev) => ({
        ...prev,
        pendingTx: tx,
      }));
      if (status === "confirmed" || status === "failed") {
        // Clear after a delay to let user see the toast
        setTimeout(() => {
          clearOptimistic();
        }, 2000);
      }
    });
    return unsubscribe;
  }, [clearOptimistic]);

  return {
    optimisticState,
    registerOptimistic,
    updateTxHash,
    setOptimisticValues,
    clearOptimistic,
    markFailed,
    pendingTransactions: manager.getAllPending(),
  };
}

export { manager as optimisticTransactionManager };
