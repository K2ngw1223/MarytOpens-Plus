'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('查看本机器人绑定的 MarytOpens 身份与权限'),

  async execute({ interaction, mo }) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await mo.whoami();
      const b = res.bot || res || {};
      const embed = new EmbedBuilder()
        .setTitle('MarytOpens 机器人身份')
        .setColor(0x6366f1)
        .addFields(
          { name: '名称', value: String(b.name || b.id || '?'), inline: true },
          { name: '绑定作用域', value: String(b.boundScope || 'global'), inline: true },
          { name: '调用次数', value: String(b.calls ?? 0), inline: true },
          { name: '权限', value: (b.scopes || []).join(', ') || '（无）' },
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (e) {
      await interaction.editReply({ content: '❌ 获取身份失败：' + e.message });
    }
  },
};
