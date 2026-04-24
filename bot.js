const TelegramBot = require('node-telegram-bot-api');
const { addAccount, getAccounts, deleteAccount, logCheck } = require('./db');
const { loginAndCheckExpiry } = require('./xserver');

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

// ─── Menu Keyboard ──────────────────────────────────────────────────────────

function mainMenu() {
  return {
    keyboard: [
      ['📋 账号列表', '➕ 添加账号'],
      ['🔄 立即检测', '❌ 删除账号'],
      ['📖 帮助'],
    ],
    resize_keyboard: true,
  };
}

function inlineRenewMenu(accountId) {
  return {
    inline_keyboard: [
      [
        {
          text: '🔗 打开 XServer 登录页',
          url: 'https://secure.xserver.ne.jp/xapanel/login/xvps/',
        },
      ],
      [{ text: '✅ 我已更新，重新检查', callback_data: `recheck:${accountId}` }],
    ],
  };
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const userId = msg.chat.id;

  const text = `🤖 *XServer VPS 续期机器人*

欢迎！此机器人帮你管理 XServer VPS 账号并检测到期时间。

*功能：*
• 添加/删除 XServer 账号
• 自动检测利用期限
• 临期提醒（≤1天）

*快捷命令：*
/start - 显示此菜单
/add - 添加账号
/list - 查看已保存账号
/check - 立即检测期限
/renew <id> - 获取续期入口
/help - 帮助`;

  bot.sendMessage(userId, text, {
    parse_mode: 'Markdown',
    reply_markup: mainMenu(),
  });
});

bot.onText(/\/help/, (msg) => {
  const userId = msg.chat.id;
  bot.sendMessage(userId,
    `*使用指南*\n\n` +
    `1. /add - 输入用户名和密码保存账号\n` +
    `2. /check - 立即检测所有账号到期时间\n` +
    `3. 账号临期前1天会收到提醒\n` +
    `4. 收到提醒后用 /renew <id> 获取续期入口\n` +
    `5. 手动完成网站验证后点「我已更新，重新检查」`,
    { parse_mode: 'Markdown', reply_markup: mainMenu() }
  );
});

bot.onText(/\/add/, (msg) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  pendingActions.set(userId, { action: 'waiting_username' });
  bot.sendMessage(userId, '📝 请输入 XServer 用户名（邮箱）:', { reply_markup: { force_reply: true } });
});

bot.onText(/\/list/, async (msg) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  const accounts = getAccounts(userId);
  if (accounts.length === 0) {
    return bot.sendMessage(userId, '没有保存任何账号。用 /add 添加。', { reply_markup: mainMenu() });
  }

  const list = accounts.map((acc) =>
    `• *${acc.username}* (ID: ${acc.id})\n  添加于 ${acc.created_at}`
  ).join('\n\n');

  bot.sendMessage(userId, `*已保存账号 (${accounts.length}):*\n\n${list}`, {
    parse_mode: 'Markdown',
    reply_markup: mainMenu(),
  });
});

bot.onText(/\/delete (\d+)/, (msg, match) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  const accountId = parseInt(match[1]);
  const result = deleteAccount(userId, accountId);
  if (result.changes > 0) {
    bot.sendMessage(userId, '✅ 账号已删除。', { reply_markup: mainMenu() });
  } else {
    bot.sendMessage(userId, '❌ 未找到该账号。', { reply_markup: mainMenu() });
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
      parse_mode: 'Markdown',
    });
  } catch (err) {
    bot.editMessageText(`❌ 检测失败: ${err.message}`, {
      chat_id: userId,
      message_id: sentMsg.message_id,
    });
  }
});

// ─── Inline Button Handlers ───────────────────────────────────────────────────

bot.on('message', (msg) => {
  const userId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;
  if (!isAdmin(userId)) return;

  // Handle menu button inputs
  if (text === '📋 账号列表') {
    return bot.emit('message', { ...msg, text: '/list' });
  }
  if (text === '➕ 添加账号') {
    return bot.emit('message', { ...msg, text: '/add' });
  }
  if (text === '🔄 立即检测') {
    return bot.emit('message', { ...msg, text: '/check' });
  }
  if (text === '📖 帮助') {
    return bot.emit('message', { ...msg, text: '/help' });
  }
  if (text === '❌ 删除账号') {
    const accounts = getAccounts(userId);
    if (accounts.length === 0) {
      return bot.sendMessage(userId, '没有账号可删除。', { reply_markup: mainMenu() });
    }
    const list = accounts.map((acc) => `• ${acc.username} (ID: ${acc.id})`).join('\n');
    pendingActions.set(userId, { action: 'waiting_delete_id' });
    return bot.sendMessage(userId, `请回复要删除的账号 ID：\n\n${list}`, { reply_markup: { force_reply: true } });
  }

  const state = pendingActions.get(userId);
  if (!state) return;

  if (state.action === 'waiting_username') {
    state.username = text;
    state.action = 'waiting_password';
    bot.sendMessage(userId, '🔐 请输入密码:', { reply_markup: { force_reply: true } });
  } else if (state.action === 'waiting_password') {
    const username = state.username;
    const password = text;
    pendingActions.delete(userId);

    try {
      addAccount(userId, username, password);
      bot.sendMessage(userId, `✅ 账号已保存: ${username}`, { reply_markup: mainMenu() });
    } catch (err) {
      bot.sendMessage(userId, `❌ 保存失败: ${err.message}`);
    }
  } else if (state.action === 'waiting_delete_id') {
    const accountId = parseInt(text.trim());
    pendingActions.delete(userId);

    if (!Number.isInteger(accountId)) {
      return bot.sendMessage(userId, '❌ ID 格式不正确', { reply_markup: mainMenu() });
    }

    const result = deleteAccount(userId, accountId);
    if (result.changes > 0) {
      return bot.sendMessage(userId, '✅ 账号已删除。', { reply_markup: mainMenu() });
    }
    return bot.sendMessage(userId, '❌ 未找到该账号。', { reply_markup: mainMenu() });
  }
});

// /renew <id> - get renewal link
bot.onText(/\/renew (\d+)/, (msg, match) => {
  const userId = msg.chat.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(userId, '❌ 只有管理员可以使用此机器人');
  }

  const accountId = parseInt(match[1]);
  const accounts = getAccounts(userId);
  const account = accounts.find(a => a.id === accountId);

  if (!account) {
    return bot.sendMessage(userId, '❌ 未找到该账号。', { reply_markup: mainMenu() });
  }

  bot.sendMessage(userId,
    `📦 账号: *${account.username}*\n\n` +
    `请按以下步骤手动续期:\n\n` +
    `1. 点击「打开 XServer 登录页」\n` +
    `2. 登录后进入 VPS 首页\n` +
    `3. 点击「契約情報」\n` +
    `4. 点击「更新する」\n` +
    `5. 点击「引き続き無料VPSの利用を継続する」\n` +
    `6. 输入数字验证码\n` +
    `7. 如有 Cloudflare 验证请手动完成\n` +
    `8. 点击「無料VPSの利用を継続する」\n` +
    `9. 完成后返回此机器人点「我已更新，重新检查」`,
    {
      parse_mode: 'Markdown',
      reply_markup: inlineRenewMenu(accountId),
    }
  );
});

// Callback for recheck button
bot.on('callback_query', async (query) => {
  const userId = query.message.chat.id;
  const data = query.data;

  if (!data.startsWith('recheck:')) return;

  const accountId = parseInt(data.split(':')[1]);
  const accounts = getAccounts(userId);
  const account = accounts.find(a => a.id === accountId);

  if (!account) {
    bot.answerCallbackQuery(query.id, { text: '❌ 未找到账号' });
    return;
  }

  bot.answerCallbackQuery(query.id, { text: '🔄 正在重新检测...' });

  const result = await loginAndCheckExpiry(account.username, account.password);
  logCheck(userId, account.id, result.expiryDate || null, result.daysLeft || null);

  let msgText;
  if (result.success) {
    if (result.needsRenewal) {
      msgText = `⚠️ *${account.username}*\n仍需续期！剩余 *${result.daysLeft} 天*\n到期日: ${result.expiryDate}\n\n请继续手动续期流程。`;
    } else {
      msgText = `🎉 *${account.username}*\n✅ 续期成功！剩余 *${result.daysLeft} 天*\n到期日: ${result.expiryDate}`;
    }
  } else {
    msgText = `❌ *${account.username}*\n检查失败: ${result.error}`;
  }

  bot.editMessageText(msgText, {
    chat_id: userId,
    message_id: query.message.message_id,
    parse_mode: 'Markdown',
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

// ─── Auto-check Timer ─────────────────────────────────────────────────────────

async function autoCheckAndRemind() {
  if (!ADMIN_ID) return;

  const accounts = getAccounts(ADMIN_ID);
  if (accounts.length === 0) return;

  for (const acc of accounts) {
    try {
      const result = await loginAndCheckExpiry(acc.username, acc.password);
      logCheck(ADMIN_ID, acc.id, result.expiryDate || null, result.daysLeft || null);

      if (result.success && result.daysLeft <= 1) {
        await bot.sendMessage(
          ADMIN_ID,
          `⚠️ *XServer VPS 到期提醒*\n\n账号: *${acc.username}*\n到期日: *${result.expiryDate}*\n剩余: *${result.daysLeft} 天*\n\n请尽快续期。`,
          {
            parse_mode: 'Markdown',
            reply_markup: inlineRenewMenu(acc.id),
          }
        );
      }
    } catch (e) {
      console.error(`Auto-check failed for ${acc.username}: ${e.message}`);
    }
  }
}

// Run first check 30s after startup, then every 6 hours
setTimeout(autoCheckAndRemind, 30 * 1000);
setInterval(autoCheckAndRemind, 6 * 60 * 60 * 1000);

console.log('✅ XServer Renew Bot started');
