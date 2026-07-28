export enum ActionType {
  Pause = "Pause",
  Unpause = "Unpause",
  EmergencyWithdraw = "EmergencyWithdraw",
  RemoveMember = "RemoveMember",
}

export interface PendingAction {
  hash: string;
  type: ActionType;
  approvals: string[];
  action_data: Uint8Array;
  requestedBy: string;
}
