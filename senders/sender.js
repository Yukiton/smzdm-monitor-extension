/**
 * 发送器抽象基类
 * 所有发送器实现必须继承此类
 */
class BaseSender {
  /**
   * @param {Object} config - 发送器配置
   */
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * 创建错误结果对象（统一错误处理）
   * @param {string} error - 错误信息
   * @returns {{success: boolean, error: string}}
   */
  createErrorResult(error) {
    return { success: false, error };
  }

  /**
   * 创建成功结果对象
   * @param {Object} data - 附加数据
   * @returns {{success: boolean, data?: Object}}
   */
  createSuccessResult(data = {}) {
    return { success: true, ...data };
  }

  /**
   * 发送爆料通知
   * @param {Array} items - 爆料项列表
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async send(items) {
    throw new Error('send() must be implemented');
  }

  /**
   * 发送验证码警报
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendCaptchaAlert() {
    throw new Error('sendCaptchaAlert() must be implemented');
  }

  /**
   * 发送测试通知
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendTest() {
    throw new Error('sendTest() must be implemented');
  }

  /**
   * 验证配置是否有效
   * @returns {{success: boolean, error?: string}}
   */
  validateConfig() {
    throw new Error('validateConfig() must be implemented');
  }

  /**
   * 发送调试模式通知
   * 默认实现：发送单条爆料
   * @param {Object} item - 单条爆料项
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendDebug(item) {
    return this.send([item]);
  }

  /**
   * 发送测试抓取结果
   * 默认实现：发送多条爆料
   * @param {Array} items - 爆料项列表
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendFetchResult(items) {
    return this.send(items);
  }

  /**
   * 发送器唯一标识名称
   * @type {string}
   */
  static get name() {
    throw new Error('static name must be implemented');
  }

  /**
   * 发送器显示名称（用于 UI 展示）
   * @type {string}
   */
  static get displayName() {
    throw new Error('static displayName must be implemented');
  }

  /**
   * 发送器图标（emoji 或图片 URL）
   * @type {string}
   */
  static get icon() {
    return '📤';
  }

  /**
   * 发送器描述
   * @type {string}
   */
  static get description() {
    return '';
  }

  /**
   * 配置字段定义（用于 UI 动态渲染）
   * @type {Array<{key: string, label: string, type: string, placeholder?: string, help?: string, required?: boolean, options?: Array}>}
   */
  static get configFields() {
    return [];
  }

  /**
   * 检查是否有必需的配置字段
   * @returns {{valid: boolean, missingFields: Array<string>}}
   */
  hasRequiredConfig() {
    const fields = this.constructor.configFields || [];
    const missingFields = [];

    fields.forEach(field => {
      if (field.required) {
        const value = this.config[field.key];
        if (value === undefined || value === null || value === '') {
          missingFields.push(field.label || field.key);
        }
      }
    });

    return {
      valid: missingFields.length === 0,
      missingFields
    };
  }

  /**
   * 格式化时间（通用实现）
   * @param {Date} date - 日期对象
   * @returns {string} 格式化后的时间字符串
   */
  formatTime(date = new Date()) {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * 验证并返回安全的链接
   * 只允许 http 和 https 协议，防止 javascript: 等危险协议
   * @param {string} link - 原始链接
   * @returns {string} 安全的链接或空字符串
   */
  safeLink(link) {
    if (!link) return '';
    const trimmed = link.trim();
    // 只允许 http 和 https 协议
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    return '';
  }

  /**
   * 转义 HTML 特殊字符
   * @param {string} text - 原始文本
   * @returns {string} 转义后的文本
   */
  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 转义 Markdown 特殊字符
   * @param {string} text - 原始文本
   * @returns {string} 转义后的文本
   */
  escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/([*_`\[\]])/g, '\\$1');
  }
}

// 用于 background.js 中作为 Service Worker 导出
if (typeof self !== 'undefined') {
  self.BaseSender = BaseSender;
}