'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publish')
    .setDescription('将内容发布到 MarytOpens 社区（创建一篇文章）')
    .addStringOption((o) => o.setName('title').setDescription('文章标题').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('content').setDescription('正文（支持 Markdown）').setRequired(true))
    .addStringOption((o) => o.setName('tags').setDescription('标签，逗号分隔，最多 8 个').setRequired(false))
    .addStringOption((o) => o.setName('board').setDescription('板块（留空用默认）').setRequired(false))
    .addStringOption((o) => o.setName('author').setDescription('作者用户 ID（留空用配置默认）').setRequired(false)),

  async execute({ interaction, mo, perms, config }) {
    const need = 'post.create';
    if (!perms.can(need, interaction.member)) {
      const roles = ((perms.raw.mappings[need] || {}).discordRoles || []).join('、') || '（未配置）';
      return interaction.reply({ content: '⛔ 你没有发布权限，需要 Discord 角色：' + roles, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const authorOpt = interaction.options.getString('author');
    const authorId = authorOpt
      || perms.defaultAuthorFor('post.create')
      || config.marytOpens.defaultAuthorId;

    if (!authorId) {
      return interaction.editReply({ content: '⚠️ 未配置默认作者（defaultAuthorId），且未提供 author 参数，无法发布。' });
    }

    const title = interaction.options.getString('title');
    const content = interaction.options.getString('content');
    const tagsRaw = interaction.options.getString('tags');
    const board = interaction.options.getString('board') || perms.defaultBoard;

    const tags = tagsRaw
      ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8)
      : [];

    try {
      const res = await mo.createPost({ authorId, title, content, tags, board, scope: 'global' });
      const url = res.post && res.post.url;
      await interaction.editReply({ content: '✅ 已发布：' + (url || JSON.stringify(res.post || res)) });
    } catch (e) {
      await interaction.editReply({ content: '❌ 发布失败：' + e.message });
    }
  },
};
