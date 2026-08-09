'use strict';

/**
 * 配置加载：优先读取环境变量（.env），其次回退到 config.json 中的非敏感字段。
 * 令牌类敏感信息只从环境变量读取，绝不写进 config.json。
 */
const fs = require('fs');
const path = require('path');

function loadConfig() {
  // dotenv 在 .env 存在时加载；不存在则静默忽略
  try { require('dotenv').config(); } catch (e) { /* dotenv 未安装时跳过 */ }

  let fileCfg = {};
  const cfgPath = path.join(__dirname, '..', 'config.json');
  try {
    fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    fileCfg = {};
  }

  const dFile = fileCfg.discord || {};
  const mFile = fileCfg.marytOpens || {};

  return {
    discord: {
      token: process.env.DISCORD_TOKEN || dFile.token || '',
      guildId: process.env.DISCORD_GUILD_ID || dFile.guildId || '',
      publishChannelId: dFile.publishChannelId || '',
      modLogChannelId: dFile.modLogChannelId || '',
      mirrorChannel: !!dFile.mirrorChannel,
    },
    marytOpens: {
      apiBase: process.env.MO_API_BASE || mFile.apiBase || 'https://api.natrois.top',
      botToken: process.env.MO_BOT_TOKEN || mFile.botToken || '',
      defaultAuthorId: mFile.defaultAuthorId || '',
    },
    permissionsFile: fileCfg.permissionsFile || path.join(__dirname, 'permissions.json'),
  };
}

module.exports = { loadConfig };
