'use strict';

/**
 * 读取权限映射文件（permissions.json），提供：
 *   can(perm, member)            —— 判断 Discord 成员是否拥有某操作权限
 *   defaultAuthorFor(perm)       —— 获取该操作配置的默认作者 ID
 * 角色比对基于 member.roles.cache 中的角色「名称」。
 */
const fs = require('fs');
const path = require('path');

function roleNamesOf(member) {
  if (!member || !member.roles || !member.roles.cache) return [];
  return [...member.roles.cache.values()].map((r) => r.name);
}

function loadPermissions(file) {
  const fp = file || path.join(__dirname, 'permissions.json');
  const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const map = json.mappings || {};

  return {
    raw: json,
    defaultBoard: json.defaultBoard || 'general',
    rateLimit: json.rateLimit || { publishPerUser: 10, windowMs: 60000 },

    can(perm, member) {
      const entry = map[perm];
      if (!entry) return false;
      const roles = roleNamesOf(member);
      return (entry.discordRoles || []).some((rn) => roles.includes(rn));
    },

    defaultAuthorFor(perm) {
      const entry = map[perm];
      return (entry && entry.defaultAuthorId) || null;
    },
  };
}

module.exports = { loadPermissions };
