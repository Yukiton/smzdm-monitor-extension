/**
 * 企业微信机器人发送器
 * 支持文本和 Markdown 格式消息
 */
class WeComSender extends BaseSender {
  static get name() {
    return 'wecom';
  }

  static get displayName() {
    return '企业微信机器人';
  }

  static get icon() {
    return '💼';
  }

  static get description() {
    return '通过企业微信群机器人发送通知消息';
  }

  static get configFields() {
    return [
      {
        key: 'webhookUrl',
        label: 'Webhook 地址',
        type: 'text',
        placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx',
        help: '在企业微信群中添加机器人获取',
        required: true
      },
      {
        key: 'format',
        label: '消息格式',
        type: 'select',
        options: [
          { value: 'markdown', label: 'Markdown（推荐）' },
          { value: 'text', label: '纯文本' }
        ],
        default: 'markdown'
      },
      {
        key: 'mentionAll',
        label: '警报时@所有人',
        type: 'checkbox',
        default: true,
        help: '验证码警报时提醒所有群成员'
      }
    ];
  }

  validateConfig() {
    const { webhookUrl } = this.config;

    if (!webhookUrl || !webhookUrl.trim()) {
      return this.createErrorResult('请输入 Webhook 地址');
    }

    if (!webhookUrl.includes('qyapi.weixin.qq.com')) {
      return this.createErrorResult('Webhook 地址格式不正确，应为 qyapi.weixin.qq.com 域名');
    }

    return this.createSuccessResult();
  }

  /**
   * 发送消息到企业微信
   * @param {Object} content - 消息内容对象
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendToWeCom(content) {
    const { webhookUrl } = this.config;

    if (!webhookUrl) {
      return this.createErrorResult('未配置 Webhook 地址');
    }

    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SMZDM-Monitor/1.0'
        },
        body: JSON.stringify(content),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const result = await response.json();

      if (result.errcode === 0) {
        return this.createSuccessResult();
      } else {
        return this.createErrorResult(result.errmsg || '发送失败');
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        return this.createErrorResult('请求超时');
      }
      return this.createErrorResult(e.message);
    }
  }

  /**
   * 发送爆料通知
   */
  async send(items) {
    if (!items || items.length === 0) {
      return this.createErrorResult('没有爆料内容');
    }

    // 验证配置
    const validation = this.validateConfig();
    if (!validation.success) {
      return validation;
    }

    const content = this.config.format === 'text'
      ? this.formatText(items)
      : this.formatMarkdown(items);

    return this.sendToWeCom(content);
  }

  /**
   * 格式化 Markdown 消息
   */
  formatMarkdown(items) {
    const now = this.formatTime();
    const itemsContent = items.slice(0, 10).map((item, i) => {
      const safeUrl = this.safeLink(item.link);
      const linkText = safeUrl ? `[查看详情](${safeUrl})` : '';
      return `**${i + 1}. ${this.escapeMarkdown(item.title)}**\n` +
        `> 💰 价格: ${item.price}\n` +
        `> ⏰ 时间: ${item.time}` +
        (linkText ? `\n> 🔗 ${linkText}` : '');
    }).join('\n\n');

    const footer = items.length > 10
      ? `\n\n... 还有 ${items.length - 10} 条爆料`
      : '';

    return {
      msgtype: 'markdown',
      markdown: {
        content:
          `## 📢 新爆料通知\n\n` +
          `⏰ 检测时间: ${now}\n` +
          `📊 发现 **${items.length}** 条新爆料\n\n` +
          `---\n\n` +
          `${itemsContent}${footer}\n\n` +
          `---\n` +
          `*SMZDM 爆料监控器*`
      }
    };
  }

  /**
   * 格式化纯文本消息
   */
  formatText(items) {
    const now = this.formatTime();
    const itemsText = items.map((item, i) =>
      `${i + 1}. ${item.title}\n   价格: ${item.price}`
    ).join('\n');

    return {
      msgtype: 'text',
      text: {
        content:
          `【新爆料通知】\n` +
          `检测时间: ${now}\n` +
          `发现 ${items.length} 条新爆料:\n\n` +
          `${itemsText}`
      }
    };
  }

  /**
   * 发送验证码警报
   */
  async sendCaptchaAlert() {
    const mentionAll = this.config.mentionAll !== false; // 默认 true
    const content = {
      msgtype: 'text',
      text: {
        content:
          `⚠️【验证码警报】\n` +
          `检测时间: ${this.formatTime()}\n` +
          `监控页面出现验证码，请立即处理！\n\n` +
          `处理方式:\n` +
          `1. 打开监控标签页\n` +
          `2. 手动完成验证\n` +
          `3. 验证通过后监控将自动恢复`
      }
    };

    if (mentionAll) {
      content.text.mentioned_list = ['@all'];
    }

    return this.sendToWeCom(content);
  }

  /**
   * 发送测试通知
   */
  async sendTest() {
    const content = {
      msgtype: 'text',
      text: {
        content:
          `🧪 测试通知\n` +
          `这是一条来自 SMZDM 爆料监控器的测试消息。\n` +
          `时间: ${this.formatTime()}\n\n` +
          `✅ 通知功能正常！`
      }
    };

    return this.sendToWeCom(content);
  }

  /**
   * 发送调试模式通知
   */
  async sendDebug(item) {
    const safeUrl = this.safeLink(item.link);
    const linkText = safeUrl ? `[查看详情](${safeUrl})` : '';

    const content = {
      msgtype: 'markdown',
      markdown: {
        content:
          `## 🐛 调试模式推送\n\n` +
          `⏰ 检测时间: ${this.formatTime()}\n` +
          `> 此消息为调试模式自动推送\n\n` +
          `---\n\n` +
          `**${this.escapeMarkdown(item.title)}**\n` +
          `> 💰 价格: ${item.price}\n` +
          `> ⏰ 时间: ${item.time}` +
          (linkText ? `\n> 🔗 ${linkText}` : '') +
          `\n\n---\n` +
          `*SMZDM 爆料监控器 调试模式*`
      }
    };

    return this.sendToWeCom(content);
  }

  /**
   * 发送测试抓取结果
   */
  async sendFetchResult(items) {
    const itemsContent = items.slice(0, 10).map((item, i) => {
      const safeUrl = this.safeLink(item.link);
      const linkText = safeUrl ? `[查看详情](${safeUrl})` : '';
      return `**${i + 1}. ${this.escapeMarkdown(item.title)}**\n` +
        `> 💰 价格: ${item.price}\n` +
        `> ⏰ 时间: ${item.time}` +
        (linkText ? `\n> 🔗 ${linkText}` : '');
    }).join('\n\n');

    const footer = items.length > 10 ? `\n\n... 还有 ${items.length - 10} 条` : '';

    const content = {
      msgtype: 'markdown',
      markdown: {
        content:
          `## 🧪 测试抓取结果\n\n` +
          `⏰ 抓取时间: ${this.formatTime()}\n` +
          `📊 抓取数量: **${items.length}** 条\n\n` +
          `---\n\n` +
          `${itemsContent}${footer}` +
          `\n\n---\n*由 SMZDM 爆料监控器 测试抓取推送*`
      }
    };

    return this.sendToWeCom(content);
  }
}

// 用于 background.js 中作为 Service Worker 导出
if (typeof self !== 'undefined') {
  self.WeComSender = WeComSender;
}