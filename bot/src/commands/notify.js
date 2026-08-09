'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notify')
    .setDescription('向指定 MarytOpens 用户推送一条站内通知')
    .addStringOption((o) => o.setName('user').setDescription('目标用户 ID').setRequired(true))
    .addStringOption((o) => o.setName('title').setDescription('通知标题').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('body').setDescription('通知正文（≤400）').setRequired(false))
    .addStringOption((o) => o.setName('link').setDescription('跳转链接').setRequired(false)),

  async execute({ interaction, mo, perms }) {
    if (!perms.can('notify', interaction.member)) {
      const roles = ((perms.raw.mappings.notify || {}).discordRoles || []).join('、') || '（未配置）';
      return interaction.reply({ content: '⛔ 你没有通知权限，需要 Discord 角色：' + roles, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user');
    const title = interaction.options.getString('title');
    const body = interaction.options.getString('body') || '';
    const link = interaction.options.getString('link') || '';

    try {
      const res = await mo.notify({ userId, title, body, link });
      await interaction.editReply({ content: '✅ 已推送通知给用户 ' + (res.notified || userId) });
    } catch (e) {
      await interaction.editReply({ content: '❌ 推送失败：' + e.message });
    }
  },
};
