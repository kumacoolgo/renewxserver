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
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // 1. 登录页：不要等 networkidle
    await page.goto(LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.locator('#memberid').waitFor({ timeout: 30000 });
    await page.locator('#memberid').fill(username);
    await page.locator('#user_password').fill(password);

    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
      page.locator('text=ログインする').click(),
    ]);

    // 2. 直接进入 VPS 列表页
    await page.goto(VPS_INDEX_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // 3. 等关键内容，不等 networkidle
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const title = await page.title().catch(() => '');

    // 如果被踢回登录页，说明登录失败或被验证拦截
    if (currentUrl.includes('/login/')) {
      return {
        success: false,
        error: '登录后仍在登录页，可能账号密码错误或触发额外验证',
      };
    }

    // 4. 读取免费 VPS 到期日
    const expiryText = await page
      .locator('tr:has(.freeServerIco) .contract__term')
      .first()
      .textContent({ timeout: 30000 })
      .catch(() => null);

    if (!expiryText) {
      const bodyText = await page.locator('body').textContent({ timeout: 10000 }).catch(() => '');
      const shortText = bodyText.slice(0, 300).replace(/\s+/g, ' ');

      return {
        success: false,
        error: `找不到免费 VPS 利用期限。当前URL: ${currentUrl} / 标题: ${title} / 页面片段: ${shortText}`,
      };
    }

    return parseExpiry(expiryText.trim());
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  } finally {
    await browser.close();
  }
}

function parseExpiry(text) {
  const match = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) {
    return {
      success: false,
      error: `日期格式不正确: ${text}`,
    };
  }

  const expiryDate = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;

  const todayText = new Date().toLocaleDateString('sv', {
    timeZone: 'Asia/Tokyo',
  });

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
