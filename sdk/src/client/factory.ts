import { JointSaveError } from "../errors";
import { bytes32, bytesToHex, scAddress, scBytesN32 } from "../scval";
import type { PoolType, TxResult } from "../types";
import type { ContractCaller, SendOptions } from "./base";

export interface PoolRegistry {
  rotational: string[];
  target: string[];
  flexible: string[];
}

export interface PoolLookup {
  id: string;
  type: PoolType;
}

function toHex(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return Buffer.from(value).toString("hex");
  return String(value).toLowerCase();
}

export class FactoryClient {
  readonly contractId: string;
  private readonly client: ContractCaller;

  constructor(client: ContractCaller) {
    this.client = client;
    this.contractId = client.requireContractId("factory");
  }

  async getRotationalPools(): Promise<string[]> {
    const ids = await this.client.read<unknown[]>(this.contractId, "all_rotational");
    return ids.map(toHex);
  }

  async getTargetPools(): Promise<string[]> {
    const ids = await this.client.read<unknown[]>(this.contractId, "all_target");
    return ids.map(toHex);
  }

  async getFlexiblePools(): Promise<string[]> {
    const ids = await this.client.read<unknown[]>(this.contractId, "all_flexible");
    return ids.map(toHex);
  }

  async getPools(): Promise<PoolRegistry> {
    const [rotational, target, flexible] = await Promise.all([
      this.getRotationalPools(),
      this.getTargetPools(),
      this.getFlexiblePools(),
    ]);
    return { rotational, target, flexible };
  }

  async getPool(poolId: string): Promise<PoolLookup | null> {
    const normalized = bytesToHex(bytes32(poolId));
    const registry = await this.getPools();
    for (const type of ["rotational", "target", "flexible"] as const) {
      if (registry[type].includes(normalized)) return { id: normalized, type };
    }
    return null;
  }

  async getToken(): Promise<string> {
    return this.client.read<string>(this.contractId, "token");
  }

  async getTreasury(): Promise<string> {
    return this.client.read<string>(this.contractId, "treasury");
  }

  async getVersion(): Promise<number> {
    return this.client.read<number>(this.contractId, "get_version");
  }

  async registerPool(
    caller: string,
    poolId: string,
    poolType: PoolType,
    options: SendOptions
  ): Promise<TxResult> {
    switch (poolType) {
      case "rotational":
        return this.registerRotational(caller, poolId, options);
      case "target":
        return this.registerTarget(caller, poolId, options);
      case "flexible":
        return this.registerFlexible(caller, poolId, options);
      default: {
        const exhaustive: never = poolType;
        throw new JointSaveError("INVALID_ARGUMENT", `Unknown pool type: ${String(exhaustive)}`, {
          method: "registerPool",
          contract: this.contractId,
        });
      }
    }
  }

  async registerRotational(caller: string, poolId: string, options: SendOptions): Promise<TxResult> {
    return this.client.send(
      this.contractId,
      "register_rotational",
      [scAddress(caller), scBytesN32(poolId)],
      options
    );
  }

  async registerTarget(caller: string, poolId: string, options: SendOptions): Promise<TxResult> {
    return this.client.send(
      this.contractId,
      "register_target",
      [scAddress(caller), scBytesN32(poolId)],
      options
    );
  }

  async registerFlexible(caller: string, poolId: string, options: SendOptions): Promise<TxResult> {
    return this.client.send(
      this.contractId,
      "register_flexible",
      [scAddress(caller), scBytesN32(poolId)],
      options
    );
  }
}
