'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('feed')
    .setDescription('拉取 MarytOpens 最新公开文章')
    .addIntegerOption((o) => o.setName('limit').setDescription('数量（1-50）').setRequired(false).setMinValue(1).setMaxValue(50)),

  async execute({ interaction, mo }) {
    await interaction.deferReply();
    const limit = interaction.options.getInteger('limit') || 10;
    try {
      const res = await mo.feed({ limit });
      const items = (res.items || []).slice(0, limit);
      if (!items.length) {
        return interaction.editReply({ content: '📭 暂无公开文章。' });
      }
      const lines = items.map((p, i) => {
        const when = p.createdAt ? ' · <t:' + Math.floor(p.createdAt / 1000) + ':R>' : '';
        return '**' + (i + 1) + '. ' + p.title + '**' + when + '\n' + p.url;
      }).join('\n');
      const embed = new EmbedBuilder()
        .setTitle('MarytOpens 最新文章')
        .setDescription(lines)
        .setColor(0x6366f1)
        .setFooter({ text: '共 ' + items.length + ' 篇' });
      await interaction.editReply({ embeds: [embed] });
    } catch (e) {
      await interaction.editReply({ content: '❌ 获取失败：' + e.message });
    }
  },
};
