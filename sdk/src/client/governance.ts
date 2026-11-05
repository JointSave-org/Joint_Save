import { JointSaveError } from "../errors";
import {
  bytes32,
  bytesToHex,
  bytesToI128,
  hexToBytes,
  i128ToBeBytes,
  scAddress,
  scBool,
  scBytesMap,
  scBytesN32,
  scString,
  scUnitEnum,
} from "../scval";
import { isValidContractId } from "../utils/address";
import type {
  GovernanceProposal,
  GovernanceProposalStatus,
  GovernanceProposalType,
  TxResult,
  YieldProposalInput,
} from "../types";
import type { ContractCaller, SendOptions } from "./base";

const ONCHAIN_PROPOSAL_TYPES = new Set([
  "ChangeDepositAmount",
  "ExtendDeadline",
  "AddPenalty",
  "RemovePenalty",
  "ChangeQuorum",
  "Custom",
]);

export interface CreateProposalParams {
  proposer: string;
  proposalType: GovernanceProposalType;
  description: string;
  parameters?: Record<string, Uint8Array>;
}

export interface VoteOptions extends SendOptions {
  voter: string;
  proposalId: string;
  inFavor: boolean;
}

function decodeEnum(value: unknown): string {
  if (Array.isArray(value)) {
    const [first] = value;
    return typeof first === "string" ? first : String(first);
  }
  if (typeof value === "string") return value;
  return String(value);
}

function decodeParams(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw instanceof Uint8Array) out[key] = bytesToHex(raw);
    else if (Array.isArray(raw)) out[key] = bytesToHex(raw);
    else if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

export function decodeYieldAllocationParams(
  parameters: Record<string, string> | undefined
): YieldProposalInput | null {
  if (!parameters) return null;
  const actionHex = parameters.action;
  const amountHex = parameters.amount;
  if (!actionHex || !amountHex) return null;

  let action: string;
  try {
    action = Buffer.from(hexToBytes(actionHex)).toString("utf8");
  } catch {
    return null;
  }
  if (action !== "alloc" && action !== "dealloc") return null;
  if (amountHex.length !== 32) return null;

  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = bytesToI128(hexToBytes(amountHex));
  } catch {
    return null;
  }

  const vault = parameters.vault
    ? Buffer.from(hexToBytes(parameters.vault)).toString("utf8")
    : undefined;

  return vault === undefined ? { action, amountBaseUnits } : { action, vault, amountBaseUnits };
}

export function buildYieldAllocationParams(input: YieldProposalInput): Record<string, string> {
  const params: Record<string, string> = {
    action: bytesToHex(new TextEncoder().encode(input.action)),
    amount: bytesToHex(i128ToBeBytes(input.amountBaseUnits)),
  };
  if (input.action === "alloc") {
    if (!input.vault) {
      throw new JointSaveError("INVALID_ARGUMENT", "vault required for allocation proposals", {
        method: "buildYieldAllocationParams",
      });
    }
    if (!isValidContractId(input.vault)) {
      throw new JointSaveError("INVALID_ARGUMENT", `invalid vault contract id: ${input.vault}`, {
        method: "buildYieldAllocationParams",
      });
    }
    params.vault = bytesToHex(new TextEncoder().encode(input.vault));
  }
  return params;
}

export function encodeYieldAllocationParams(input: YieldProposalInput): Record<string, Uint8Array> {
  const hex = buildYieldAllocationParams(input);
  const out: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(hex)) out[key] = hexToBytes(value);
  return out;
}

function decodeProposal(raw: unknown): GovernanceProposal {
  const value = raw as Record<string, unknown>;
  const parameters = decodeParams(value.parameters);
  const onChainType = decodeEnum(value.proposal_type);
  const isYield = parameters !== undefined && decodeYieldAllocationParams(parameters) !== null;

  const proposal: GovernanceProposal = {
    id:
      typeof value.id === "string"
        ? value.id
        : value.id instanceof Uint8Array
          ? bytesToHex(value.id)
          : String(value.id),
    proposer: String(value.proposer),
    proposalType: (isYield ? "YieldAllocation" : onChainType) as GovernanceProposalType,
    description: value.description === undefined ? "" : String(value.description),
    votesFor: Array.isArray(value.votes_for) ? value.votes_for.map(String) : [],
    votesAgainst: Array.isArray(value.votes_against) ? value.votes_against.map(String) : [],
    status: decodeEnum(value.status) as GovernanceProposalStatus,
    createdAt: Number(value.created_at),
    expiresAt: Number(value.expires_at),
  };
  if (parameters !== undefined) proposal.parameters = parameters;
  return proposal;
}

export class GovernanceClient {
  readonly contractId: string;
  private readonly client: ContractCaller;

  constructor(client: ContractCaller) {
    this.client = client;
    this.contractId = client.requireContractId("governance");
  }

  async getActiveProposals(poolId: string): Promise<GovernanceProposal[]> {
    const proposals = await this.client.read<unknown[]>(this.contractId, "get_active_proposals", [
      scAddress(poolId),
    ]);
    return proposals.map(decodeProposal);
  }

  async getRecentProposals(): Promise<GovernanceProposal[]> {
    const proposals = await this.client.read<unknown[]>(this.contractId, "get_recent_proposals");
    return proposals.map(decodeProposal);
  }

  async getProposals(poolId?: string): Promise<GovernanceProposal[]> {
    return poolId ? this.getActiveProposals(poolId) : this.getRecentProposals();
  }

  async getProposal(proposalId: string): Promise<GovernanceProposal> {
    const proposal = await this.client.read<unknown>(this.contractId, "get_proposal", [
      scBytesN32(proposalId),
    ]);
    return decodeProposal(proposal);
  }

  async getVotingQuorum(): Promise<number> {
    return this.client.read<number>(this.contractId, "get_voting_quorum");
  }

  async createProposal(params: CreateProposalParams, options: SendOptions): Promise<TxResult> {
    const onChainType = params.proposalType === "YieldAllocation" ? "Custom" : params.proposalType;
    if (!ONCHAIN_PROPOSAL_TYPES.has(onChainType)) {
      throw new JointSaveError(
        "UNSUPPORTED",
        `Proposal type ${params.proposalType} is not supported on-chain`,
        { method: "createProposal", contract: this.contractId }
      );
    }
    return this.client.send(
      this.contractId,
      "create_proposal",
      [
        scAddress(params.proposer),
        scUnitEnum(onChainType),
        scString(params.description),
        scBytesMap(params.parameters ?? {}),
      ],
      options
    );
  }

  async createYieldAllocationProposal(
    proposer: string,
    input: YieldProposalInput,
    description: string,
    options: SendOptions
  ): Promise<TxResult> {
    return this.createProposal(
      {
        proposer,
        proposalType: "YieldAllocation",
        description,
        parameters: encodeYieldAllocationParams(input),
      },
      options
    );
  }

  async vote(options: VoteOptions): Promise<TxResult> {
    return this.client.send(
      this.contractId,
      "vote",
      [scAddress(options.voter), scBytesN32(options.proposalId), scBool(options.inFavor)],
      options
    );
  }

  async execute(executor: string, proposalId: string, options: SendOptions): Promise<TxResult> {
    return this.client.send(
      this.contractId,
      "execute_proposal",
      [scAddress(executor), scBytesN32(proposalId)],
      options
    );
  }

  async expire(executor: string, proposalId: string, options: SendOptions): Promise<TxResult> {
    return this.client.send(
      this.contractId,
      "expire_proposal",
      [scAddress(executor), scBytesN32(proposalId)],
      options
    );
  }

  /** Convert a decoded id back to its 32-byte hex form. */
  static normalizeProposalId(proposalId: string): string {
    return bytesToHex(bytes32(proposalId));
  }
}
