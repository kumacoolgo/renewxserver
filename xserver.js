const { chromium } = require('playwright');

const LOGIN_URL = 'https://secure.xserver.ne.jp/xapanel/?action=user_login_index';
const VPS_INDEX_URL = 'https://secure.xserver.ne.jp/xapanel/xvps/index';

async function loginAndCheckExpiry(username, password) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1: Login
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('input[name="login_id"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/xapanel/**', { timeout: 15000 });

    // Step 2: Go to VPS index
    await page.goto(VPS_INDEX_URL, { waitUntil: 'networkidle' });

    // Step 3: Extract expiry date
    // Selector: tr:has(.freeServerIco) .contract__term
    const expiryText = await page.$eval(
      'tr:has(.freeServerIco) .contract__term',
      el => el.textContent.trim()
    ).catch(() => null);

    if (!expiryText) {
      // Try alternative selectors
      const altSelectors = [
        '.contract__term',
        'tr.contract__row .contract__term',
        '[class*="term"]'
      ];
      for (const sel of altSelectors) {
        const text = await page.$(sel);
        if (text) {
          const content = await text.textContent();
          if (content && content.match(/\d{4}-\d{2}-\d{2}/)) {
            return parseExpiry(content.trim());
          }
        }
      }
      return { success: false, error: 'Could not find expiry date on page' };
    }

    return parseExpiry(expiryText);
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

function parseExpiry(text) {
  // Expected format: 2026-04-25
  const match = text.match(/(\d{4}[-\/]\d{2}[-\/]\d{2})/);
  if (!match) {
    return { success: false, error: `Invalid date format: ${text}` };
  }

  const expiryDate = new Date(match[1].replace(/\//g, '-'));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);

  const diffTime = expiryDate - today;
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    success: true,
    expiryDate: match[1].replace(/\//g, '-'),
    daysLeft,
    needsRenewal: daysLeft <= 1
  };
}

async function getRenewalUrl(username, password) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('input[name="login_id"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/xapanel/**', { timeout: 15000 });

    await page.goto(VPS_INDEX_URL, { waitUntil: 'networkidle' });

    // Find renewal button link
    const renewLink = await page.$eval(
      'tr:has(.freeServerIco) a[href*="freevps/extend"]',
      el => el.href
    ).catch(() => null);

    return renewLink || 'https://secure.xserver.ne.jp/xapanel/freevps/extend/index';
  } catch (err) {
    return null;
  } finally {
    await browser.close();
  }
}

module.exports = { loginAndCheckExpiry, getRenewalUrl };
