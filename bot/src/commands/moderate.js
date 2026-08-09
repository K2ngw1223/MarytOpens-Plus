'use strict';

const { SlashCommandBuilder } = require('discord.js');

/** 从文章 ID 或文章链接中提取 post id */
function extractPostId(input) {
  if (!input) return '';
  if (/^[\w-]+$/.test(input)) return input;
  const m = /[?&]id=([\w-]+)/.exec(input);
  if (m) return m[1];
  return input.trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderate')
    .setDescription('对 MarytOpens 文章执行审核操作（删除 / 锁定 / 置顶）')
    .addStringOption((o) => o.setName('post').setDescription('文章 ID 或文章链接').setRequired(true))
    .addStringOption((o) => o.setName('action').setDescription('操作类型').setRequired(true)
      .addChoices(
        { name: '删除', value: 'delete' },
        { name: '锁定', value: 'lock' },
        { name: '置顶', value: 'pin' }))
    .addStringOption((o) => o.setName('reason').setDescription('原因（可选，≤200）').setRequired(false)),

  async execute({ interaction, mo, perms }) {
    if (!perms.can('post.delete.any', interaction.member)) {
      const roles = ((perms.raw.mappings['post.delete.any'] || {}).discordRoles || []).join('、') || '（未配置）';
      return interaction.reply({ content: '⛔ 你没有审核权限，需要 Discord 角色：' + roles, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const postId = extractPostId(interaction.options.getString('post'));
    const action = interaction.options.getString('action');
    const reason = interaction.options.getString('reason') || '';

    if (!postId) {
      return interaction.editReply({ content: '⚠️ 无法解析文章 ID。' });
    }

    try {
      const res = await mo.moderate({ postId, action, reason });
      await interaction.editReply({ content: '✅ 已对文章 ' + res.moderated + ' 执行操作：' + res.action });
    } catch (e) {
      await interaction.editReply({ content: '❌ 操作失败：' + e.message });
    }
  },
};
