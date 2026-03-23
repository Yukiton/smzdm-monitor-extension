/**
 * Resend Email 发送器
 * 通过 Resend API 发送邮件通知
 */
class ResendSender extends BaseSender {
  static get name() {
    return 'resend';
  }

  static get displayName() {
    return 'Resend Email';
  }

  static get icon() {
    return '📧';
  }

  static get description() {
    return '通过 Resend 服务发送邮件通知';
  }

  static get configFields() {
    return [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 're_xxxxxxxxxx',
        help: '在 resend.com 获取 API Key',
        required: true
      },
      {
        key: 'from',
        label: '发件人地址',
        type: 'text',
        placeholder: 'noreply@yourdomain.com',
        help: '默认使用 Resend 测试地址，自定义域名需在 Resend 验证',
        required: true,
        default: 'onboarding@resend.dev'
      },
      {
        key: 'to',
        label: '收件人地址',
        type: 'text',
        placeholder: 'user@example.com',
        help: '多个收件人用逗号分隔',
        required: true
      },
      {
        key: 'subjectPrefix',
        label: '邮件主题前缀',
        type: 'text',
        placeholder: '[SMZDM]',
        help: '可选，用于区分邮件来源',
        default: '[SMZDM 爆料]'
      }
    ];
  }

  validateConfig() {
    const { apiKey, from, to } = this.config;

    if (!apiKey || !apiKey.trim()) {
      return this.createErrorResult('请输入 API Key');
    }

    // Resend API Key 格式：测试环境以 re_ 开头，生产环境可能以其他前缀开头
    // 至少需要 10 个字符
    if (apiKey.trim().length < 10) {
      return this.createErrorResult('API Key 格式不正确，长度不足');
    }

    if (!from || !from.trim()) {
      return this.createErrorResult('请输入发件人地址');
    }

    if (!to || !to.trim()) {
      return this.createErrorResult('请输入收件人地址');
    }

    // 简单验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(from.trim())) {
      return this.createErrorResult('发件人地址格式不正确');
    }

    const toEmails = this.getToEmails();
    for (const email of toEmails) {
      if (!emailRegex.test(email)) {
        return this.createErrorResult(`收件人地址格式不正确: ${email}`);
      }
    }

    return this.createSuccessResult();
  }

  /**
   * 获取收件人列表
   */
  getToEmails() {
    const { to } = this.config;
    if (!to || typeof to !== 'string') return [];
    return to.split(',')
      .map(email => email.trim())
      .filter(email => email && email.includes('@')); // 基本验证
  }

  /**
   * 发送邮件
   * @param {Object} emailData - 邮件数据
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendEmail(emailData) {
    const { apiKey, from } = this.config;
    const toEmails = this.getToEmails();

    if (!apiKey || !from || toEmails.length === 0) {
      return this.createErrorResult('邮件配置不完整');
    }

    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: from.trim(),
          to: toEmails,
          subject: emailData.subject,
          html: emailData.html
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const result = await response.json();

      if (response.ok && result.id) {
        return this.createSuccessResult({ id: result.id });
      } else {
        return this.createErrorResult(result.message || result.error?.message || '发送失败');
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

    const subjectPrefix = this.config.subjectPrefix || '[SMZDM 爆料]';
    const content = `发现 ${items.length} 条新爆料`;
    // 限制主题长度，但确保前缀完整保留
    const maxSubjectLength = 200;
    const availableLength = maxSubjectLength - subjectPrefix.length - 1; // 1 for space
    const truncatedContent = content.length > availableLength ? content.slice(0, availableLength - 3) + '...' : content;
    const subject = `${subjectPrefix} ${truncatedContent}`;

    const html = this.formatHtmlEmail(items);

    return this.sendEmail({ subject, html });
  }

  /**
   * 格式化 HTML 邮件内容
   */
  formatHtmlEmail(items) {
    const now = this.formatTime();

    const itemsHtml = items.slice(0, 10).map((item, i) => {
      const safeUrl = this.escapeHtml(this.safeLink(item.link));
      const linkHtml = safeUrl
        ? `<a href="${safeUrl}" style="display: inline-block; margin-top: 10px; padding: 6px 12px; background: #667eea; color: white; text-decoration: none; border-radius: 4px; font-size: 12px;">查看详情</a>`
        : '';

      return `
        <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #667eea;">
          <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">
            ${i + 1}. ${this.escapeHtml(item.title)}
          </h3>
          <p style="margin: 5px 0; color: #666; font-size: 14px;">
            💰 价格: <strong style="color: #e53935;">${this.escapeHtml(item.price || '未知')}</strong>
          </p>
          <p style="margin: 5px 0; color: #666; font-size: 14px;">
            ⏰ 时间: ${this.escapeHtml(item.time || '未知')}
          </p>
          ${linkHtml}
        </div>
      `;
    }).join('');

    const footerHtml = items.length > 10
      ? `<p style="color: #999; font-size: 14px; text-align: center;">... 还有 ${items.length - 10} 条爆料</p>`
      : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #667eea; margin: 0;">📢 新爆料通知</h1>
          <p style="color: #666; margin: 10px 0 0 0;">
            ⏰ 检测时间: ${now}<br>
            📊 发现 <strong style="color: #667eea;">${items.length}</strong> 条新爆料
          </p>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">

        ${itemsHtml}
        ${footerHtml}

        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">

        <p style="text-align: center; color: #999; font-size: 12px;">
          SMZDM 爆料监控器 | 自动推送通知
        </p>
      </body>
      </html>
    `;
  }

  /**
   * 发送验证码警报
   */
  async sendCaptchaAlert() {
    const validation = this.validateConfig();
    if (!validation.success) {
      return validation;
    }

    const subjectPrefix = this.config.subjectPrefix || '[SMZDM 爆料]';
    const subject = `${subjectPrefix} ⚠️ 验证码警报`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #f56565; margin: 0;">⚠️ 验证码警报</h1>
          <p style="color: #666; margin: 10px 0 0 0;">
            检测时间: ${this.formatTime()}
          </p>
        </div>

        <div style="background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0 0 15px 0; color: #c53030; font-weight: bold; font-size: 16px;">
            监控页面出现验证码，请立即处理！
          </p>
          <ol style="margin: 0; padding-left: 20px; color: #666;">
            <li>打开监控标签页</li>
            <li>手动完成验证</li>
            <li>验证通过后监控将自动恢复</li>
          </ol>
        </div>

        <p style="text-align: center; color: #999; font-size: 12px;">
          SMZDM 爆料监控器 | 验证码警报
        </p>
      </body>
      </html>
    `;

    return this.sendEmail({ subject, html });
  }

  /**
   * 发送测试通知
   */
  async sendTest() {
    const validation = this.validateConfig();
    if (!validation.success) {
      return validation;
    }

    const subjectPrefix = this.config.subjectPrefix || '[SMZDM 爆料]';
    const subject = `${subjectPrefix} 🧪 测试通知`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #48bb78; margin: 0;">🧪 测试通知</h1>
          <p style="color: #666; margin: 10px 0 0 0;">
            这是一条来自 SMZDM 爆料监控器的测试消息
          </p>
        </div>

        <div style="background: #f0fff4; border: 1px solid #9ae6b4; border-radius: 8px; padding: 20px; text-align: center;">
          <p style="margin: 0; color: #276749; font-size: 18px; font-weight: bold;">
            ✅ 通知功能正常！
          </p>
          <p style="margin: 10px 0 0 0; color: #666;">
            发送时间: ${this.formatTime()}
          </p>
        </div>

        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
          SMZDM 爆料监控器 | 测试通知
        </p>
      </body>
      </html>
    `;

    return this.sendEmail({ subject, html });
  }

  /**
   * 发送调试模式通知
   */
  async sendDebug(item) {
    const validation = this.validateConfig();
    if (!validation.success) {
      return validation;
    }

    const subjectPrefix = this.config.subjectPrefix || '[SMZDM 爆料]';
    const subject = `${subjectPrefix} 🐛 调试模式推送`;

    const safeUrl = this.escapeHtml(this.safeLink(item.link));
    const linkHtml = safeUrl
      ? `<a href="${safeUrl}" style="display: inline-block; margin-top: 10px; padding: 6px 12px; background: #ed8936; color: white; text-decoration: none; border-radius: 4px; font-size: 12px;">查看详情</a>`
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #ed8936; margin: 0;">🐛 调试模式推送</h1>
          <p style="color: #666; margin: 10px 0 0 0;">
            此消息为调试模式自动推送
          </p>
        </div>

        <div style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #ed8936;">
          <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">
            ${this.escapeHtml(item.title)}
          </h3>
          <p style="margin: 5px 0; color: #666; font-size: 14px;">
            💰 价格: <strong style="color: #e53935;">${this.escapeHtml(item.price || '未知')}</strong>
          </p>
          <p style="margin: 5px 0; color: #666; font-size: 14px;">
            ⏰ 时间: ${this.escapeHtml(item.time || '未知')}
          </p>
          ${linkHtml}
        </div>

        <p style="text-align: center; color: #999; font-size: 12px;">
          SMZDM 爆料监控器 | 调试模式
        </p>
      </body>
      </html>
    `;

    return this.sendEmail({ subject, html });
  }

  /**
   * 发送测试抓取结果
   */
  async sendFetchResult(items) {
    const validation = this.validateConfig();
    if (!validation.success) {
      return validation;
    }

    const subjectPrefix = this.config.subjectPrefix || '[SMZDM 爆料]';
    const subject = `${subjectPrefix} 🧪 测试抓取结果 - ${items.length} 条`;

    const html = this.formatHtmlEmail(items);

    return this.sendEmail({ subject, html });
  }
}

// 用于 background.js 中作为 Service Worker 导出
if (typeof self !== 'undefined') {
  self.ResendSender = ResendSender;
}