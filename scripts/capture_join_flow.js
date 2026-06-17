const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const contractId = process.argv[2] || process.env.CONTRACT_ID;
  if (!contractId) {
    console.error('Usage: node capture_join_flow.js <CONTRACT_ID>');
    process.exit(1);
  }

  const base = process.env.BASE_URL || 'http://localhost:3000';
  const url = `${base.replace(/\/$/, '')}/join/${contractId}`;
  const outputDir = path.resolve(__dirname, 'screenshots');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (!response || response.status() >= 400) {
      throw new Error(`Page failed to load: ${response ? response.status() : 'no response'}`);
    }
  } catch (error) {
    console.error(`Failed to load ${url}`);
    console.error(error.message);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(1000);

  const shareSelectorCandidates = [
    'button:has-text("Share")',
    '[aria-label="share"]',
    '[data-test="share"]',
    'button[class*=share]',
    'a:has-text("Share")',
  ];

  let savedShare = false;
  for (const sel of shareSelectorCandidates) {
    const el = await page.$(sel);
    if (el) {
      await el.screenshot({ path: path.join(outputDir, 'share-button.png') });
      savedShare = true;
      break;
    }
  }

  if (!savedShare) {
    console.warn('Share button not found using default selectors. Saving a full-page screenshot for manual cropping.');
    await page.screenshot({ path: path.join(outputDir, 'share-button-fallback.png'), fullPage: true });
  }

  const actionSelectors = [
    'button:has-text("Request")',
    'button:has-text("Join")',
    '[data-test="request-join"]',
    'button[class*=join]',
  ];

  let clicked = false;
  for (const sel of actionSelectors) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click();
      clicked = true;
      break;
    }
  }

  if (clicked) {
    await page.waitForTimeout(1500);
  } else {
    console.warn('No join/request button found using default selectors. Capturing the page anyway.');
  }

  await page.screenshot({ path: path.join(outputDir, 'join-flow.png'), fullPage: true });

  await browser.close();
  console.log(`Screenshots saved to ${outputDir}`);
})();
