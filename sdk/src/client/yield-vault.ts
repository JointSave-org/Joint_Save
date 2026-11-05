import { scAddress, scBool, scI128, scU32 } from "../scval";
import type { TxResult, YieldAllocationState } from "../types";
import type { ContractCaller, SendOptions } from "./base";

export interface VaultInfo {
  totalAssets: bigint;
  totalShares: bigint;
  sharePrice: bigint;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(String(value ?? 0));
}

function toNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function toAddressOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class YieldVaultClient {
  private readonly client: ContractCaller;

  constructor(client: ContractCaller) {
    this.client = client;
  }

  async getState(poolId: string): Promise<YieldAllocationState> {
    const [vault, shares, costBasis, bufferBps, locked, position, unrealised, maxAllocatable] =
      await Promise.all([
        this.client.read<unknown>(poolId, "yield_vault"),
        this.client.read<bigint>(poolId, "yield_shares"),
        this.client.read<bigint>(poolId, "yield_cost_basis"),
        this.client.read<number>(poolId, "yield_buffer_bps"),
        this.client.read<boolean>(poolId, "yield_locked"),
        this.client.read<bigint>(poolId, "yield_position"),
        this.client.read<bigint>(poolId, "unrealised_yield"),
        this.client.read<bigint>(poolId, "max_allocatable_amount"),
      ]);

    return {
      vault: toAddressOrNull(vault),
      shares: toBigInt(shares),
      costBasis: toBigInt(costBasis),
      bufferBps: toNumber(bufferBps),
      locked,
      position: toBigInt(position),
      unrealised: toBigInt(unrealised),
      maxAllocatable: toBigInt(maxAllocatable),
    };
  }

  async getVault(poolId: string): Promise<string | null> {
    const vault = await this.client.read<unknown>(poolId, "yield_vault");
    return toAddressOrNull(vault);
  }

  async getVaultInfo(vaultId: string): Promise<VaultInfo> {
    const [totalAssets, totalShares, sharePrice] = await Promise.all([
      this.client.read<bigint>(vaultId, "total_assets"),
      this.client.read<bigint>(vaultId, "total_shares"),
      this.client.read<bigint>(vaultId, "share_price"),
    ]);
    return {
      totalAssets: toBigInt(totalAssets),
      totalShares: toBigInt(totalShares),
      sharePrice: toBigInt(sharePrice),
    };
  }

  async allocate(
    poolId: string,
    caller: string,
    vault: string,
    amount: bigint,
    options: SendOptions
  ): Promise<TxResult> {
    return this.client.send(
      poolId,
      "apply_yield_allocation",
      [scAddress(caller), scAddress(vault), scI128(amount)],
      options
    );
  }

  async deallocate(
    poolId: string,
    caller: string,
    amount: bigint,
    options: SendOptions
  ): Promise<TxResult> {
    return this.client.send(
      poolId,
      "apply_yield_deallocation",
      [scAddress(caller), scI128(amount)],
      options
    );
  }

  async sync(poolId: string, caller: string, options: SendOptions): Promise<TxResult> {
    return this.client.send(poolId, "sync_yield", [scAddress(caller)], options);
  }

  async setBuffer(poolId: string, admin: string, bps: number, options: SendOptions): Promise<TxResult> {
    return this.client.send(poolId, "set_yield_buffer", [scAddress(admin), scU32(bps)], options);
  }

  async setLocked(
    poolId: string,
    admin: string,
    locked: boolean,
    options: SendOptions
  ): Promise<TxResult> {
    return this.client.send(poolId, "set_yield_locked", [scAddress(admin), scBool(locked)], options);
  }
}
