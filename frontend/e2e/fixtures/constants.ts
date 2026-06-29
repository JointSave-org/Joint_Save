/**
 * Shared E2E constants. These must stay in sync with the test-gated seam in
 * frontend/hooks/useJointSaveContracts.ts and frontend/components/web3-provider.tsx.
 */

/** Default connected test wallet (matches E2E_DEFAULT_ADDRESS in the seam). */
export const E2E_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"

/** A second valid G… address used as the required 2nd member in create flows. */
export const E2E_MEMBER_2 = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"

/**
 * Contract id the stubbed `deploy()` returns and that view reads key on.
 * Must equal E2E_CONTRACT_ID in useJointSaveContracts.ts so the data provider's
 * `/api/pools?contract=…` lookup resolves to the right mocked pool.
 */
export const E2E_CONTRACT_ID = "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
