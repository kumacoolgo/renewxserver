const TelegramBot = require('node-telegram-bot-api');
const { addAccount, getAccounts, deleteAccount, logCheck } = require('./db');
const { loginAndCheckExpiry, getRenewalUrl } = require('./xserver');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID ? parseInt(process.env.ADMIN_TELEGRAM_ID) : null;

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// In-memory pending verification state
const pendingActions = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function isAdmin(userId) {
  return ADMIN_ID && userId === ADMIN_ID;
}

async function checkAllAccounts(userId) {
  const accounts = getAccounts(userId);
  if (accounts.length === 0) {
    return '没有保存任何账号。先用 /add 添加账号。';
  }

  const results = [];
  for (const acc of accounts) {
    const result = await loginAndCheckExpiry(acc.username, acc.password);
    logCheck(userId, acc.id, result.expiryDate || null, result.daysLeft || null);

    if (result.success) {
      const days = result.daysLeft;
      let status = '';
      if (days <= 1) {
        status = `⚠️ 到期提醒：剩余 ${days} 天！需要续期！`;
      } else if (days <= 7) {
        status = `🟡 即将到期：剩余 ${days} 天`;
      } else {
        status = `✅ 正常：剩余 ${days} 天`;
      }
      results.push(`📦 ${acc.username}\n   ${status}\n   到期日: ${result.expiryDate}`);
    } else {
      results.push(`📦 ${acc.username}\n   ❌ 检查失败: ${result.error}`);
    }
  }
  return results.join('\n\n');
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const userId = msg.chat.id;
  const text = `🤖 *XServer VPS 续期机器人*

欢迎！此机器人帮你管理 XServer VPS 账号并检测到期时间。

*功能：*
• 添加/删除 XServer 账号
• 自动检测利用期限
• 临期提醒

*命令：*
/start - 显示此菜单
/add - 添加账号
/list - 查看已保存账号
/delete - 删除账号
/check - 检测所有账号期限
/help - 帮助信息

_只有管理员可以使用此机器人_`;

  bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  const userId = msg.chat.id;
  bot.sendMessage(userId,
    `*使用指南*\n\n` +
    `1. /add - 输入用户名和密码保存账号\n` +
    `2. /check - 立即检测所有账号到期时间\n` +
    `3. 账号临期前1天会收到提醒\n` +
    `4. 点「更新」按钮后手动完成验证`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/add/, (msg) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  pendingActions.set(userId, { action: 'waiting_username' });
  bot.sendMessage(userId, '📝 请输入 XServer 用户名（邮箱）:');
});

// ─── Message Handler for account input ──────────────────────────────────────

bot.on('message', (msg) => {
  const userId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;
  if (!isAdmin(userId)) return;

  const state = pendingActions.get(userId);
  if (!state) return;

  if (state.action === 'waiting_username') {
    state.username = text;
    state.action = 'waiting_password';
    bot.sendMessage(userId, '🔐 请输入密码:');
  } else if (state.action === 'waiting_password') {
    const username = state.username;
    const password = text;
    pendingActions.delete(userId);

    try {
      addAccount(userId, username, password);
      bot.sendMessage(userId, `✅ 账号已保存: ${username}\n\n现在用 /check 检测期限。`);
    } catch (err) {
      bot.sendMessage(userId, `❌ 保存失败: ${err.message}`);
    }
  }
});

bot.onText(/\/list/, async (msg) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  const accounts = getAccounts(userId);
  if (accounts.length === 0) {
    return bot.sendMessage(userId, '没有保存任何账号。用 /add 添加。');
  }

  const list = accounts.map((acc, i) =>
    `${i + 1}. ${acc.username} (添加于 ${acc.created_at})`
  ).join('\n');

  bot.sendMessage(userId, `*已保存账号 (${accounts.length}):*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/delete (\d+)/, (msg, match) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  const accountId = parseInt(match[1]);
  const result = deleteAccount(userId, accountId);
  if (result.changes > 0) {
    bot.sendMessage(userId, '✅ 账号已删除。');
  } else {
    bot.sendMessage(userId, '❌ 未找到该账号。');
  }
});

bot.onText(/\/check/, async (msg) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  const sentMsg = await bot.sendMessage(userId, '🔄 正在检测所有账号，请稍候...');

  try {
    const result = await checkAllAccounts(userId);
    bot.editMessageText(result, {
      chat_id: userId,
      message_id: sentMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    bot.editMessageText(`❌ 检测失败: ${err.message}`, {
      chat_id: userId,
      message_id: sentMsg.message_id
    });
  }
});

// Renewal flow
bot.onText(/\/renew (\d+)/, async (msg, match) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  const accountId = parseInt(match[1]);
  const accounts = getAccounts(userId);
  const account = accounts.find(a => a.id === accountId);

  if (!account) {
    return bot.sendMessage(userId, '❌ 未找到该账号');
  }

  const renewUrl = await getRenewalUrl(account.username, account.password);

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔗 打开 XServer 登录页', url: 'https://secure.xserver.ne.jp/xapanel/' }],
      [{ text: '✅ 我已更新，重新检查', callback_data: `recheck:${accountId}` }]
    ]
  };

  bot.sendMessage(userId,
    `📦 账号: ${account.username}\n\n` +
    `请按以下步骤手动续期:\n` +
    `1. 点击「打开 XServer 登录页」\n` +
    `2. 登录后进入 VPS 首页\n` +
    `3. 点击契约情報 → 更新する\n` +
    `4. 完成数字验证码和 CF 验证\n` +
    `5. 点击「無料VPSの利用を継続する」\n` +
    `6. 完成后点「我已更新，重新检查」`,
    { reply_markup: keyboard, parse_mode: 'Markdown' }
  );
});

// Callback for recheck button
bot.on('callback_query', async (query) => {
  const userId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('recheck:')) {
    const accountId = parseInt(data.split(':')[1]);
    const accounts = getAccounts(userId);
    const account = accounts.find(a => a.id === accountId);

    if (!account) {
      return bot.answerCallbackQuery(query.id, { text: '❌ 未找到账号' });
    }

    bot.answerCallbackQuery(query.id, { text: '🔄 正在重新检测...' });

    const result = await loginAndCheckExpiry(account.username, account.password);
    logCheck(userId, account.id, result.expiryDate || null, result.daysLeft || null);

    let msg;
    if (result.success) {
      if (result.needsRenewal) {
        msg = `⚠️ ${account.username}: 仍需续期！剩余 ${result.daysLeft} 天`;
      } else {
        msg = `✅ ${account.username}: 续期成功！剩余 ${result.daysLeft} 天，到期日 ${result.expiryDate}`;
      }
    } else {
      msg = `❌ ${account.username}: ${result.error}`;
    }

    bot.editMessageText(msg, {
      chat_id: userId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });
  }
});

// ─── Error Handling ───────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('✅ XServer Renew Bot started');
