const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'src', 'index.ts');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

console.log('Auditing public API exports in src/index.ts...');

// Verify that all intended public exports are present
const expectedExports = [
  'SDK_VERSION',
  'toBaseUnits',
  'fromBaseUnits',
  'usdcToStroops',
  'stroopsToUsdc',
  'formatTokenAmount',
  'formatUsdc',
  'formatPercent',
  'isValidStellarAccount',
  'isValidContractId',
  'isValidSorobanAddress',
  'shortAddress',
  'SECONDS_PER_LEDGER',
  'SECONDS_PER_DAY',
  'LEDGERS_PER_DAY',
  'daysToLedgers',
  'ledgersToDays',
  'ledgerToTimestamp',
  'estimateLedgerAt',
  'isPastDeadline',
  'sleep'
];

for (const exp of expectedExports) {
  if (!indexContent.includes(exp)) {
    console.error(`Missing expected public export: ${exp}`);
    process.exit(1);
  }
}

// Ensure no test files or internal mock symbols are leaked
if (indexContent.includes('.test') || indexContent.includes('tests/')) {
  console.error('Leak detected: test files must not be referenced in src/index.ts');
  process.exit(1);
}

console.log('Public API guard: PASSED (all required exports present, no internal leaks).');
