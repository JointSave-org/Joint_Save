import { describe, it, expect } from 'vitest';
import {
  isValidStellarAccount,
  isValidContractId,
  isValidSorobanAddress,
  shortAddress,
} from '../src/utils/address.js';

describe('Address validation and utilities (address.ts)', () => {
  const validAccount = 'GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSBR54IS4NGNBCITVIYBCQMGVRU';
  const validContract = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

  it('validates Stellar Account IDs (G...) and rejects invalid prefix or casing', () => {
    expect(isValidStellarAccount(validAccount)).toBe(true);
    // Lowercase must fail (case-sensitive requirement from ARCHITECTURE.md)
    expect(isValidStellarAccount(validAccount.toLowerCase())).toBe(false);
    // Wrong prefix
    expect(isValidStellarAccount(validContract)).toBe(false);
    // Wrong length
    expect(isValidStellarAccount('GAHK7EEG2WWH')).toBe(false);
    expect(isValidStellarAccount(validAccount + 'A')).toBe(false);
    // Invalid characters (0, 1, 8, 9 not in RFC 4648 Base32)
    expect(isValidStellarAccount('G' + '8'.repeat(55))).toBe(false);
    expect(isValidStellarAccount(null)).toBe(false);
    expect(isValidStellarAccount(undefined)).toBe(false);
  });

  it('validates Soroban Contract IDs (C...) and rejects invalid prefix or casing', () => {
    expect(isValidContractId(validContract)).toBe(true);
    expect(isValidContractId(validContract.toLowerCase())).toBe(false);
    expect(isValidContractId(validAccount)).toBe(false);
    expect(isValidContractId('CBIELTK6')).toBe(false);
    expect(isValidContractId(12345)).toBe(false);
  });

  it('isValidSorobanAddress accepts both G... and C... IDs', () => {
    expect(isValidSorobanAddress(validAccount)).toBe(true);
    expect(isValidSorobanAddress(validContract)).toBe(true);
    expect(isValidSorobanAddress('XYZ123')).toBe(false);
  });

  it('shortAddress abbreviates addresses with configurable ranges', () => {
    // Default 6…4
    expect(shortAddress(validAccount)).toBe('GAHK7E…GVRU');
    expect(shortAddress(validContract)).toBe('CBIELT…DAMA');

    // Custom ranges
    expect(shortAddress(validAccount, { start: 4, end: 2 })).toBe('GAHK…RU');
    expect(shortAddress(validAccount, { start: 8, end: 6, separator: '---' })).toBe('GAHK7EEG---QMGVRU');

    // Short string boundary
    expect(shortAddress('ABCDEF')).toBe('ABCDEF');
    expect(shortAddress('')).toBe('');
  });
});
