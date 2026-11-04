import { describe, expect, it } from "vitest";
import {
  isValidContractId,
  isValidSorobanAddress,
  isValidStellarAccount,
  shortAddress,
} from "./address";

const ACCOUNT = `G${"A".repeat(55)}`;
const CONTRACT = `C${"B".repeat(55)}`;

describe("address validation", () => {
  it("accepts valid account and contract strkeys", () => {
    expect(isValidStellarAccount(ACCOUNT)).toBe(true);
    expect(isValidContractId(CONTRACT)).toBe(true);
    expect(isValidSorobanAddress(ACCOUNT)).toBe(true);
    expect(isValidSorobanAddress(CONTRACT)).toBe(true);
  });

  it("rejects the wrong prefix or kind", () => {
    expect(isValidStellarAccount(CONTRACT)).toBe(false);
    expect(isValidContractId(ACCOUNT)).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidStellarAccount(ACCOUNT.slice(0, -1))).toBe(false);
    expect(isValidContractId(`${CONTRACT}X`)).toBe(false);
  });

  it("rejects lowercase and non-base32 characters", () => {
    expect(isValidStellarAccount(ACCOUNT.toLowerCase())).toBe(false);
    expect(isValidContractId(`C${"0".repeat(55)}`)).toBe(false);
    expect(isValidContractId(`C${"1".repeat(55)}`)).toBe(false);
    expect(isValidContractId(`C${"!".repeat(55)}`)).toBe(false);
  });

  it("rejects non-strings and empty values at the edge", () => {
    expect(isValidSorobanAddress("")).toBe(false);
    expect(isValidStellarAccount("G")).toBe(false);
  });
});

describe("shortAddress", () => {
  it("defaults to 6…4", () => {
    expect(shortAddress(ACCOUNT)).toBe(`${ACCOUNT.slice(0, 6)}\u2026${ACCOUNT.slice(-4)}`);
  });

  it("supports custom ranges", () => {
    expect(shortAddress(CONTRACT, { start: 4, end: 4 })).toBe(
      `${CONTRACT.slice(0, 4)}\u2026${CONTRACT.slice(-4)}`,
    );
  });

  it("returns short input unchanged", () => {
    expect(shortAddress("GABC")).toBe("GABC");
    expect(shortAddress("1234567890", { start: 6, end: 4 })).toBe("1234567890");
  });

  it("rejects negative ranges", () => {
    expect(() => shortAddress(ACCOUNT, { start: -1 })).toThrow(RangeError);
  });
});
