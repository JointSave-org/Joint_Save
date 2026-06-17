Run this Playwright script locally to capture screenshots of the join flow.

Prerequisites
- Node.js installed
- The frontend dev server running at `http://localhost:3000`

Install
```
npm install -D playwright
npx playwright install chromium
```

Usage
```
# from repository root
node scripts/capture_join_flow.js <CONTRACT_ID>
```

Example
```
node scripts/capture_join_flow.js CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI
```

If your frontend runs on a different port:
```
# PowerShell
$env:BASE_URL = 'http://localhost:3000'
node scripts/capture_join_flow.js <CONTRACT_ID>

# cmd
set "BASE_URL=http://localhost:3000"
node scripts/capture_join_flow.js <CONTRACT_ID>
```

Output
- `scripts/screenshots/share-button.png` or `scripts/screenshots/share-button-fallback.png`
- `scripts/screenshots/join-flow.png`

Troubleshooting
- If the script says the page failed to load, make sure the frontend is running and reachable at the URL printed in the error.
- If the Share button is not found, the script saves a fallback full-page screenshot instead.
- If the browser download fails, use `npx playwright install chromium` to install only Chromium.

If selectors don't match your app, update `scripts/capture_join_flow.js` with the correct button selectors.
