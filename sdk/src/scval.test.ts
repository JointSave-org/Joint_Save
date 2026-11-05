import { StrKey, scValToNative } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  bytes32,
  bytesToHex,
  bytesToI128,
  hexToBytes,
  i128ToBeBytes,
  scAddress,
  scAddressVec,
  scBool,
  scBytesHex,
  scBytesMap,
  scBytesN32,
  scI128,
  scString,
  scSymbol,
  scU32,
  scU64,
  scUnitEnum,
} from "./scval";

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));

describe("i128 encoding", () => {
  it("encodes positive values as 16 big-endian bytes", () => {
    expect(bytesToHex(i128ToBeBytes(500n))).toBe("000000000000000000000000000001f4");
    expect(bytesToHex(i128ToBeBytes(0))).toBe("00000000000000000000000000000000");
  });

  it("encodes negative values as two's complement", () => {
    expect(bytesToHex(i128ToBeBytes(-1n))).toBe("ffffffffffffffffffffffffffffffff");
    expect(bytesToI128(i128ToBeBytes(-42n))).toBe(-42n);
    expect(bytesToI128(i128ToBeBytes(1_500_000n))).toBe(1_500_000n);
  });

  it("rejects out-of-range and malformed values", () => {
    expect(() => i128ToBeBytes(1n << 127n)).toThrow(/128-bit/);
    expect(() => bytesToI128(new Uint8Array(15))).toThrow(/16 bytes/);
  });
});

describe("hex helpers", () => {
  it("round-trips bytes", () => {
    expect(bytesToHex(hexToBytes("deadbeef"))).toBe("deadbeef");
  });

  it("rejects malformed hex", () => {
    expect(() => hexToBytes("abc")).toThrow(/hexadecimal/);
    expect(() => hexToBytes("zz")).toThrow(/hexadecimal/);
  });
});

describe("bytes32 normalization", () => {
  it("accepts 32 bytes, 64-char hex, and contract ids", () => {
    expect(bytes32(new Uint8Array(32)).length).toBe(32);
    expect(bytesToHex(bytes32("11".repeat(32)))).toBe("11".repeat(32));
    expect(bytesToHex(bytes32(CONTRACT))).toHaveLength(64);
  });

  it("rejects anything else", () => {
    expect(() => bytes32("11".repeat(31))).toThrow(/32-byte/);
    expect(() => bytes32("not-an-id")).toThrow(/32-byte/);
  });
});

describe("scval encoders", () => {
  it("encodes addresses, strings, symbols, and booleans", () => {
    expect(scValToNative(scAddress(ACCOUNT))).toBe(ACCOUNT);
    expect(scValToNative(scAddressVec([ACCOUNT]))).toEqual([ACCOUNT]);
    expect(scValToNative(scString("hello"))).toBe("hello");
    expect(scValToNative(scSymbol("Custom"))).toBe("Custom");
    expect(scValToNative(scBool(true))).toBe(true);
  });

  it("encodes integers", () => {
    expect(scValToNative(scU32(7))).toBe(7);
    expect(scValToNative(scU64(9))).toBe(9n);
    expect(scValToNative(scI128(500n))).toBe(500n);
    expect(scValToNative(scI128(-500n))).toBe(-500n);
    expect(() => scU32(-1)).toThrow(/unsigned 32-bit/);
    expect(() => scU64(-1n)).toThrow(/unsigned 64-bit/);
    expect(() => scI128(1n << 127n)).toThrow(/128-bit/);
  });

  it("encodes 32-byte values from hex and contract ids", () => {
    expect(bytesToHex(scValToNative(scBytesN32("22".repeat(32))) as Uint8Array)).toBe(
      "22".repeat(32)
    );
    expect(scValToNative(scBytesHex("deadbeef"))).toEqual(Buffer.from("deadbeef", "hex"));
  });

  it("encodes unit enums as a single-symbol vector", () => {
    const val = scUnitEnum("Custom");
    expect(val.switch().name).toBe("scvVec");
    expect(scValToNative(val)).toEqual(["Custom"]);
  });

  it("encodes string-keyed byte maps", () => {
    const val = scBytesMap({ action: new TextEncoder().encode("alloc") });
    const entries = val.map();
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.key().switch().name).toBe("scvString");
    expect(entries?.[0]?.val().switch().name).toBe("scvBytes");
  });
});
