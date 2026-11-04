import { Address, nativeToScVal, StrKey, xdr } from "@stellar/stellar-sdk";

const HEX_PATTERN = /^[0-9a-fA-F]*$/;

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
    throw new RangeError("Expected an even-length hexadecimal string");
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function bytesToHex(value: Uint8Array | readonly number[]): string {
  return Buffer.from(value instanceof Uint8Array ? value : Uint8Array.from(value)).toString("hex");
}

export function scAddress(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

export function scAddressVec(addresses: readonly string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(addresses.map((address) => scAddress(address)));
}

export function scString(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "string" });
}

export function scSymbol(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "symbol" });
}

export function scBool(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

export function scU32(value: number): xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError("Expected an unsigned 32-bit integer");
  }
  return xdr.ScVal.scvU32(value);
}

export function scU64(value: bigint | number): xdr.ScVal {
  const asBigInt = typeof value === "bigint" ? value : BigInt(value);
  if (asBigInt < 0n || asBigInt > 0xffffffffffffffffn) {
    throw new RangeError("Expected an unsigned 64-bit integer");
  }
  return xdr.ScVal.scvU64(new xdr.Uint64(asBigInt));
}

export function scI128(value: bigint | number | string): xdr.ScVal {
  const asBigInt = typeof value === "bigint" ? value : BigInt(value);
  const min = -(1n << 127n);
  const max = (1n << 127n) - 1n;
  if (asBigInt < min || asBigInt > max) {
    throw new RangeError("Expected a signed 128-bit integer");
  }
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({ hi: new xdr.Int64(asBigInt >> 64n), lo: new xdr.Uint64(asBigInt & 0xffffffffffffffffn) })
  );
}

export function scBytes(value: Uint8Array | readonly number[]): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(value instanceof Uint8Array ? value : Uint8Array.from(value)));
}

export function scBytesHex(hex: string): xdr.ScVal {
  return scBytes(hexToBytes(hex));
}

export function bytes32(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) throw new RangeError("Expected a 32-byte value");
    return value;
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return hexToBytes(value);
  if (/^C[A-Z2-7]{55}$/.test(value)) return Uint8Array.from(StrKey.decodeContract(value));
  throw new RangeError("Expected a 32-byte value, 64-character hex string, or contract id");
}

export function scBytesN32(value: string | Uint8Array): xdr.ScVal {
  return scBytes(bytes32(value));
}

export function scBytesMap(values: Readonly<Record<string, Uint8Array>>): xdr.ScVal {
  const entries = Object.entries(values).map(
    ([key, value]) => new xdr.ScMapEntry({ key: scString(key), val: scBytes(value) })
  );
  return xdr.ScVal.scvMap(entries);
}

export function scUnitEnum(variant: string): xdr.ScVal {
  return xdr.ScVal.scvVec([scSymbol(variant)]);
}

export function i128ToBeBytes(value: bigint | number | string): Uint8Array {
  let normalized = typeof value === "bigint" ? value : BigInt(value);
  if (normalized < -(1n << 127n) || normalized > (1n << 127n) - 1n) {
    throw new RangeError("Expected a signed 128-bit integer");
  }
  if (normalized < 0n) normalized += 1n << 128n;
  const out = new Uint8Array(16);
  for (let i = 15; i >= 0; i -= 1) {
    out[i] = Number(normalized & 0xffn);
    normalized >>= 8n;
  }
  return out;
}

export function bytesToI128(value: Uint8Array): bigint {
  if (value.length !== 16) throw new RangeError("Expected 16 bytes for an i128");
  let result = 0n;
  for (const byte of value) result = (result << 8n) | BigInt(byte);
  if (value[0] !== undefined && (value[0] & 0x80) !== 0) result -= 1n << 128n;
  return result;
}
