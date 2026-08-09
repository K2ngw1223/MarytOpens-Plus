'use strict';

/**
 * MarytOpens Discord 社区机器人 —— 入口
 *
 * 功能：
 *   /publish   将内容发布为 MarytOpens 文章（需 post.create 权限）
 *   /notify    向指定用户推送站内通知（需 notify 权限）
 *   /moderate  删除 / 锁定 / 置顶文章（需 post.delete.any 权限）
 *   /feed      拉取最新公开文章
 *   /whoami    查看机器人绑定的平台身份与权限
 *   频道镜像   配置 mirrorChannel=true 后，发布频道内的消息自动同步为文章
 *
 * 鉴权：所有平台调用携带 X-Bot-Token；命令调用由 permissions.json 中的
 *       Discord 角色映射二次把关。
 */

const {
  Client, GatewayIntentBits, Events, REST, Routes,
} = require('discord.js');

const { loadConfig } = require('./config');
const { MarytOpensClient } = require('./marytopens');
const { loadPermissions } = require('./permissions');

const publishCmd = require('./commands/publish');
const notifyCmd = require('./commands/notify');
const moderateCmd = require('./commands/moderate');
const feedCmd = require('./commands/feed');
const whoamiCmd = require('./commands/whoami');

const config = loadConfig();
const perms = loadPermissions(config.permissionsFile);
const mo = new MarytOpensClient({
  apiBase: config.marytOpens.apiBase,
  botToken: config.marytOpens.botToken,
});

const COMMANDS = [publishCmd, notifyCmd, moderateCmd, feedCmd, whoamiCmd];
const CMD_MAP = Object.fromEntries(COMMANDS.map((c) => [c.data.name, c]));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 每个用户的发布频控
const publishLog = new Map();

function checkRate(userId) {
  const rl = perms.rateLimit || { publishPerUser: 10, windowMs: 60000 };
  const now = Date.now();
  const arr = (publishLog.get(userId) || []).filter((t) => now - t < rl.windowMs);
  if (arr.length >= rl.publishPerUser) {
    publishLog.set(userId, arr);
    return false;
  }
  arr.push(now);
  publishLog.set(userId, arr);
  return true;
}

async function registerCommands() {
  if (!config.discord.guildId) {
    console.warn('[bot] 未配置 guildId，跳过命令注册（命令需手动在 Discord 开发者后台添加）');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const body = COMMANDS.map((c) => c.data.toJSON());
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, config.discord.guildId), { body });
    console.log('[bot] 已注册 ' + body.length + ' 个斜杠命令到 Guild ' + config.discord.guildId);
  } catch (e) {
    console.error('[bot] 命令注册失败:', e.message);
  }
}

client.once(Events.ClientReady, async () => {
  console.log('[bot] 已登录为 ' + client.user.tag);
  try {
    const who = await mo.whoami();
    console.log('[bot] MarytOpens 身份:', JSON.stringify(who.bot || who));
  } catch (e) {
    console.warn('[bot] 无法连接 MarytOpens（请检查 MO_BOT_TOKEN）:', e.message);
  }
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = CMD_MAP[interaction.commandName];
  if (!cmd) return;
  try {
    await cmd.execute({ interaction, mo, perms, config, checkRate });
  } catch (e) {
    console.error('[bot] 命令执行出错 ' + interaction.commandName + ':', e && e.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '命令执行出错：' + (e && e.message), ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!config.discord.mirrorChannel || !config.discord.publishChannelId) return;
  if (message.channel.id !== config.discord.publishChannelId) return;

  // 频控（仅镜像通道）
  if (!checkRate(message.author.id)) {
    await message.reply({ content: '⏳ 你发布得太频繁了，请稍后再试。', allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  try {
    const authorId = perms.defaultAuthorFor('post.create') || config.marytOpens.defaultAuthorId;
    if (!authorId) {
      await message.reply({ content: '⚠️ 未配置默认作者，无法镜像发布。', allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }
    const firstLine = message.content.split('\n')[0].trim().slice(0, 200);
    const title = firstLine || '来自 Discord 的分享';
    const res = await mo.createPost({
      authorId,
      title,
      content: message.content,
      board: perms.defaultBoard,
      scope: 'global',
    });
    const url = res.post && res.post.url;
    await message.reply({ content: '✅ 已同步到 MarytOpens：' + (url || ''), allowedMentions: { parse: [] } }).catch(() => {});
  } catch (e) {
    await message.reply({ content: '❌ 镜像发布失败：' + e.message, allowedMentions: { parse: [] } }).catch(() => {});
  }
});

if (!config.discord.token) {
  console.error('[bot] 缺少 DISCORD_TOKEN，无法启动。请在 .env 或 config.json 中配置。');
  process.exit(1);
}
if (!config.marytOpens.botToken) {
  console.warn('[bot] 警告：缺少 MO_BOT_TOKEN，机器人将无法调用 MarytOpens API（命令会失败）。');
}

client.login(config.discord.token).catch((e) => {
  console.error('[bot] 登录失败:', e.message);
  process.exit(1);
});
