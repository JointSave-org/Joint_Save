"use client"

import { useGetPendingAction } from "@/hooks/useJointSaveContracts"
import { PendingActionCard } from "./pending-action-card"
import { PendingAction, ActionType } from "@/lib/types"
import { xdr, StrKey } from "@stellar/stellar-sdk"

const createActionData = (type: ActionType, targetAddress?: string): Uint8Array => {
  let scVal;
  switch (type) {
    case ActionType.Pause:
      scVal = xdr.ScVal.scvSymbol("Pause");
      break;
    case ActionType.Unpause:
      scVal = xdr.ScVal.scvSymbol("Unpause");
      break;
    case ActionType.RemoveMember:
      if (!targetAddress) throw new Error("Target address is required for RemoveMember action");
      scVal = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("RemoveMember"),
        new xdr.ScAddress.scAddressTypeEd25519(StrKey.decodeEd25519PublicKey(targetAddress)).toScVal(),
      ]);
      break;
    case ActionType.EmergencyWithdraw:
        if (!targetAddress) throw new Error("Target address is required for EmergencyWithdraw action");
        scVal = xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol("EmergencyWithdraw"),
            new xdr.ScAddress.scAddressTypeEd25519(StrKey.decodeEd25519PublicKey(targetAddress)).toScVal(),
        ]);
        break;
    default:
      throw new Error("Unknown action type");
  }
  return scVal.toXDR();
};

interface AdminActionFromApi {
  id: string
  pool_id: string
  admin_address: string
  action_type: ActionType
  target_address: string | null
  metadata: Record<string, unknown>
  tx_hash: string | null
  action_hash: string | null
  created_at: string
}

interface PendingActionWrapperProps {
  poolAddress: string
  action: AdminActionFromApi
  onAction: () => void
}

export function PendingActionWrapper({ poolAddress, action, onAction }: PendingActionWrapperProps) {
  const { data: approvals, isLoading } = useGetPendingAction(poolAddress, action.action_hash!)

  if (isLoading) {
    return <p>Loading action details...</p>
  }

  const pendingAction: PendingAction = {
    hash: action.action_hash!,
    type: action.action_type,
    approvals: approvals || [],
    action_data: createActionData(action.action_type, action.target_address || undefined),
    requestedBy: action.admin_address,
  }

  return <PendingActionCard poolAddress={poolAddress} action={pendingAction} onAction={onAction} />
}
