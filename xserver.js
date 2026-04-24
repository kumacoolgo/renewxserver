const { chromium } = require('playwright');

const LOGIN_URL = 'https://secure.xserver.ne.jp/xapanel/login/xvps/';
const VPS_INDEX_URL = 'https://secure.xserver.ne.jp/xapanel/xvps/index';

async function loginAndCheckExpiry(username, password) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1024 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 60000 });

    await page.locator('#memberid').fill(username);
    await page.locator('#user_password').fill(password);
    await page.locator('text=ログインする').click();

    await page.waitForURL('**/xapanel/xvps/index**', { timeout: 30000 }).catch(async () => {
      await page.goto(VPS_INDEX_URL, { waitUntil: 'networkidle', timeout: 60000 });
    });

    await page.goto(VPS_INDEX_URL, { waitUntil: 'networkidle', timeout: 60000 });

    const expiryText = await page
      .locator('tr:has(.freeServerIco) .contract__term')
      .first()
      .textContent({ timeout: 20000 })
      .catch(() => null);

    if (!expiryText) {
      await page.screenshot({ path: `/tmp/xserver-check-failed-${Date.now()}.png`, fullPage: true });
      return { success: false, error: '找不到免费 VPS 利用期限，可能登录失败或页面结构变化' };
    }

    return parseExpiry(expiryText.trim());
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

function parseExpiry(text) {
  const match = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) {
    return { success: false, error: `日期格式不正确: ${text}` };
  }

  const expiryDate = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;

  const todayText = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' });
  const today = new Date(`${todayText}T00:00:00+09:00`);
  const expiry = new Date(`${expiryDate}T00:00:00+09:00`);

  const daysLeft = Math.ceil((expiry - today) / 86400000);

  return {
    success: true,
    expiryDate,
    daysLeft,
    needsRenewal: daysLeft <= 1,
  };
}

module.exports = { loginAndCheckExpiry };
