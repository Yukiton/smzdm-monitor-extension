// SMZDM 爆料监控器 - Background Service Worker
// 版本 1.20.0 - 最终优化版本

// ==================== 配置常量 ====================
const CONFIG = {
  VERSION: '1.22.3',
  DEFAULT_INTERVAL: 60,
  MIN_INTERVAL: 30,
  MAX_INTERVAL: 600,
  MAX_RETRIES: 5,
  MAX_LOGS: 500,
  CACHE_EXPIRE: 3600000, // 1小时
  CAPTCHA_COOLDOWN: 300000, // 5分钟
  THROTTLE_DELAY: 1000,
};

// ==================== 工具类 ====================
class Utils {
  // 生成随机延迟
  static randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // 哈希函数
  static hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  // 格式化时间
  static formatTime(date = new Date()) {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  // 深拷贝
  static deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // 防抖
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // 节流
  static throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // 睡眠
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 安全获取嵌套属性
  static safeGet(obj, path, defaultValue = undefined) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj) ?? defaultValue;
  }
}

// ==================== 日志管理器 ====================
class LogManager {
  constructor(maxLogs = CONFIG.MAX_LOGS) {
    this.logs = [];
    this.maxLogs = maxLogs;
  }

  add(type, message, data = null) {
    const log = {
      id: Date.now(),
      type,
      message,
      data,
      time: Utils.formatTime(),
      timestamp: Date.now()
    };
    
    this.logs.push(log);
    
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    this.persist();
    console.log(`[SMZDM Monitor v${CONFIG.VERSION}] [${type.toUpperCase()}] ${message}`);
    return log;
  }

  info(message, data = null) { return this.add('info', message, data); }
  warn(message, data = null) { return this.add('warn', message, data); }
  error(message, data = null) { return this.add('error', message, data); }
  success(message, data = null) { return this.add('success', message, data); }

  async persist() {
    try {
      await chrome.storage.local.set({ logs: this.logs.slice(-100) });
    } catch (e) {
      console.error('日志持久化失败:', e);
    }
  }

  async load() {
    try {
      const data = await chrome.storage.local.get(['logs']);
      if (data.logs) {
        this.logs = data.logs;
      }
    } catch (e) {
      console.error('日志加载失败:', e);
    }
  }

  clear() {
    this.logs = [];
    this.persist();
  }

  getRecent(count = 50) {
    return this.logs.slice(-count);
  }
}

// ==================== 数据存储管理器 ====================
class StorageManager {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = new Map();
  }

  async get(key, defaultValue = null) {
    // 检查缓存
    if (this.cache.has(key)) {
      const expiry = this.cacheExpiry.get(key);
      if (expiry && Date.now() < expiry) {
        return this.cache.get(key);
      }
    }

    try {
      const data = await chrome.storage.local.get([key]);
      const value = data[key] ?? defaultValue;
      
      // 更新缓存
      this.cache.set(key, value);
      this.cacheExpiry.set(key, Date.now() + CONFIG.CACHE_EXPIRE);
      
      return value;
    } catch (e) {
      console.error(`存储读取失败 [${key}]:`, e);
      return defaultValue;
    }
  }

  async set(key, value, cacheExpiry = CONFIG.CACHE_EXPIRE) {
    try {
      await chrome.storage.local.set({ [key]: value });
      
      // 更新缓存
      this.cache.set(key, value);
      this.cacheExpiry.set(key, Date.now() + cacheExpiry);
      
      return true;
    } catch (e) {
      console.error(`存储写入失败 [${key}]:`, e);
      return false;
    }
  }

  async remove(key) {
    try {
      await chrome.storage.local.remove([key]);
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
      return true;
    } catch (e) {
      console.error(`存储删除失败 [${key}]:`, e);
      return false;
    }
  }

  async clear() {
    try {
      await chrome.storage.local.clear();
      this.cache.clear();
      this.cacheExpiry.clear();
      return true;
    } catch (e) {
      console.error('存储清空失败:', e);
      return false;
    }
  }

  invalidateCache(key) {
    this.cache.delete(key);
    this.cacheExpiry.delete(key);
  }
}

// ==================== 反爬虫策略 ====================
class AntiCrawlerStrategy {
  constructor(settings) {
    this.settings = settings;
    this.userAgents = {
      edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    };
  }

  getRefreshInterval() {
    const baseInterval = this.settings.refreshInterval || CONFIG.DEFAULT_INTERVAL;
    
    switch (this.settings.antiCrawlerStrategy) {
      case 'conservative':
        // 保守模式：2-4倍间隔
        return baseInterval * (2 + Math.random() * 2);
      
      case 'aggressive':
        // 激进模式：0.5-1倍间隔
        return Math.max(baseInterval * (0.5 + Math.random() * 0.5), CONFIG.MIN_INTERVAL);
      
      case 'adaptive':
        // 自适应模式：根据历史数据调整
        return this.getAdaptiveInterval(baseInterval);
      
      case 'fixed':
        // 固定模式：严格按照设定间隔
        return baseInterval;
      
      case 'random':
      default:
        // 随机模式：±30%波动
        return baseInterval + (Math.random() - 0.5) * baseInterval * 0.6;
    }
  }

  getAdaptiveInterval(baseInterval) {
    // 根据检测频率动态调整
    // 如果最近有更新，缩短间隔
    // 如果长时间无更新，延长间隔
    return baseInterval;
  }

  getUserAgent() {
    const uaType = this.settings.userAgent || 'edge';
    
    if (uaType === 'random') {
      const types = Object.keys(this.userAgents);
      return this.userAgents[types[Math.floor(Math.random() * types.length)]];
    }
    
    return this.userAgents[uaType] || this.userAgents.edge;
  }

  getBehaviorDelay() {
    // 模拟人类行为的随机延迟
    return Utils.randomDelay(100, 3000);
  }

  getMouseMovements() {
    // 生成模拟鼠标移动轨迹
    const movements = [];
    const count = Utils.randomDelay(3, 10);
    
    for (let i = 0; i < count; i++) {
      movements.push({
        x: Utils.randomDelay(0, 1920),
        y: Utils.randomDelay(0, 1080),
        delay: Utils.randomDelay(50, 200)
      });
    }
    
    return movements;
  }

  getScrollPattern() {
    // 生成模拟滚动模式
    return {
      direction: Math.random() > 0.5 ? 'down' : 'up',
      distance: Utils.randomDelay(100, 500),
      speed: Utils.randomDelay(50, 200)
    };
  }
}

// ==================== 验证码检测器 ====================
class CaptchaDetector {
  constructor(sensitivity = 'medium') {
    this.sensitivity = sensitivity;
    this.patterns = {
      high: {
        selectors: ['.geetest', '.gt_slider', '#nc_1_wrapper', '[class*="captcha-verify"]'],
        keywords: []
      },
      medium: {
        selectors: ['.geetest', '.gt_slider', '#nc_1_wrapper', '[class*="captcha"]', '[id*="captcha"]'],
        keywords: ['验证码', 'captcha', '安全验证', '人机验证', '滑动验证', '请完成验证']
      },
      low: {
        selectors: ['[class*="verify"]', '[class*="captcha"]', '[id*="captcha"]', '[id*="verify"]'],
        keywords: ['验证', '码', 'captcha', 'verify', '安全', '人机', '滑块', '点选']
      }
    };
  }

  detect(pageContent) {
    const pattern = this.patterns[this.sensitivity];
    
    // 检测选择器
    for (const selector of pattern.selectors) {
      if (pageContent.includes(selector.replace(/[\[\]\.]/g, ''))) {
        return { detected: true, type: 'selector', selector };
      }
    }
    
    // 检测关键词
    const lowerContent = pageContent.toLowerCase();
    for (const keyword of pattern.keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return { detected: true, type: 'keyword', keyword };
      }
    }
    
    return { detected: false };
  }

  detectFromDOM() {
    const pattern = this.patterns[this.sensitivity];
    
    for (const selector of pattern.selectors) {
      const elem = document.querySelector(selector);
      if (elem) {
        return { detected: true, element: elem, selector };
      }
    }
    
    return { detected: false };
  }
}

// ==================== 内容提取器 ====================
class ContentExtractor {
  constructor() {
    this.selectors = {
      itemContainer: '.pandect-content-common',
      title: '.pandect-content-title a',
      price: '.pandect-content-detail .price',
      time: '.pandect-content-time',
      image: '.pandect-content-img img',
      link: '.pandect-content-title a',
      source: '.z-feed-foot-l .source',
      likes: '.zhi span',
      comments: '.icon-comment-o-thin + span'
    };
  }

  extract() {
    const items = [];
    const containers = document.querySelectorAll(this.selectors.itemContainer);
    
    containers.forEach((container, index) => {
      try {
        const item = this.extractItem(container, index);
        if (item && item.title) {
          items.push(item);
        }
      } catch (e) {
        console.error('提取项目失败:', e, container);
      }
    });
    
    return items;
  }

  extractItem(container, index) {
    const titleElem = container.querySelector(this.selectors.title);
    const priceElem = container.querySelector(this.selectors.price);
    const timeElem = container.querySelector(this.selectors.time);
    const imgElem = container.querySelector(this.selectors.image);
    const linkElem = container.querySelector(this.selectors.link);
    const sourceElem = container.querySelector(this.selectors.source);
    const likesElem = container.querySelector(this.selectors.likes);
    const commentsElem = container.querySelector(this.selectors.comments);

    return {
      id: this.generateId(linkElem?.href || `item-${Date.now()}-${index}`),
      title: this.sanitizeText(titleElem?.textContent),
      price: this.sanitizeText(priceElem?.textContent),
      time: this.sanitizeText(timeElem?.textContent),
      image: imgElem?.src || '',
      link: linkElem?.href || '',
      source: this.sanitizeText(sourceElem?.textContent),
      likes: parseInt(likesElem?.textContent) || 0,
      comments: parseInt(commentsElem?.textContent) || 0,
      extractedAt: Date.now(),
      hash: null
    };
  }

  generateId(link) {
    // 从链接中提取唯一ID
    const match = link.match(/\/p\/(\d+)/);
    return match ? match[1] : Utils.hashString(link);
  }

  sanitizeText(text) {
    if (!text) return '';
    return text.trim().replace(/\s+/g, ' ');
  }

  calculateHash(item) {
    return Utils.hashString(`${item.id}-${item.title}-${item.price}`);
  }
}

// ==================== 通知服务 ====================
class NotificationService {
  constructor(webhookUrl, format = 'markdown') {
    this.webhookUrl = webhookUrl;
    this.format = format;
    this.queue = [];
    this.isProcessing = false;
    this.rateLimitDelay = 1000; // 1秒间隔
    this.lastSendTime = 0;
  }

  async send(items) {
    if (!this.webhookUrl) {
      throw new Error('未配置 Webhook');
    }

    // 检查频率限制
    const now = Date.now();
    if (now - this.lastSendTime < this.rateLimitDelay) {
      await Utils.sleep(this.rateLimitDelay);
    }

    const content = this.formatContent(items);
    
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'SMZDM-Monitor/1.0'
        },
        body: JSON.stringify(content)
      });

      const result = await response.json();
      this.lastSendTime = Date.now();
      
      if (result.errcode === 0) {
        return { success: true };
      } else {
        throw new Error(result.errmsg || '发送失败');
      }
    } catch (e) {
      throw e;
    }
  }

  formatContent(items) {
    if (this.format === 'markdown') {
      return this.formatMarkdown(items);
    }
    return this.formatText(items);
  }

  formatMarkdown(items) {
    const now = Utils.formatTime();
    const itemsMd = items.map((item, i) => 
      `**${i + 1}. ${item.title}**\n` +
      `> 价格: ${item.price}\n` +
      `> 来源: ${item.source || '未知'}\n` +
      `> 时间: ${item.time}\n` +
      `> [查看详情](${item.link})`
    ).join('\n\n');

    return {
      msgtype: 'markdown',
      markdown: {
        content: `## 🔔 新爆料通知\n\n` +
                 `⏰ 检测时间: ${now}\n` +
                 `📊 新爆料数量: **${items.length}** 条\n\n` +
                 `---\n\n${itemsMd}\n\n` +
                 `---\n` +
                 `*由 SMZDM 爆料监控器 自动推送*`
      }
    };
  }

  formatText(items) {
    const now = Utils.formatTime();
    const itemsText = items.map((item, i) => 
      `${i + 1}. ${item.title}\n   价格: ${item.price}`
    ).join('\n');

    return {
      msgtype: 'text',
      text: {
        content: `【新爆料通知】\n` +
                 `检测时间: ${now}\n` +
                 `发现 ${items.length} 条新爆料:\n\n` +
                 `${itemsText}`
      }
    };
  }

  async sendCaptchaAlert() {
    if (!this.webhookUrl) return;

    const content = {
      msgtype: 'text',
      text: {
        content: `⚠️【验证码警报】\n` +
                 `检测时间: ${Utils.formatTime()}\n` +
                 `监控页面出现验证码，请立即处理！\n\n` +
                 `处理方式:\n` +
                 `1. 打开监控标签页\n` +
                 `2. 手动完成验证\n` +
                 `3. 验证通过后监控将自动恢复`
      },
      mentioned_list: ['@all']
    };

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content)
      });
    } catch (e) {
      console.error('验证码通知发送失败:', e);
    }
  }

  async sendTestNotification() {
    const content = {
      msgtype: 'text',
      text: {
        content: `🧪 测试通知\n` +
                 `这是一条来自 SMZDM 爆料监控器的测试消息。\n` +
                 `时间: ${Utils.formatTime()}\n` +
                 `版本: v${CONFIG.VERSION}\n\n` +
                 `✅ 通知功能正常！`
      }
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content)
      });
      
      const result = await response.json();
      return result.errcode === 0;
    } catch (e) {
      return false;
    }
  }
}

// ==================== 核心监控器 ====================
class SMZDMMonitor {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.currentTabId = null;
    this.settings = {};
    this.stats = {
      checkCount: 0,
      newCount: 0,
      captchaCount: 0,
      startTime: null,
      lastCheck: null,
      nextCheckTime: null
    };
    
    // 初始化组件
    this.logger = new LogManager();
    this.storage = new StorageManager();
    this.antiCrawler = null;
    this.captchaDetector = null;
    this.contentExtractor = null;
    this.notifier = null;
    
    this.init();
  }

  async init() {
    // 加载设置
    await this.loadSettings();
    
    // 加载统计
    await this.loadStats();
    
    // 加载日志
    await this.logger.load();
    
    // 监听消息
    this.setupMessageListener();
    
    // 监听定时器
    this.setupAlarmListener();
    
    // 监听标签页关闭
    this.setupTabListener();
    
    // 恢复监控状态
    await this.restoreMonitorState();
    
    this.logger.info(`后台服务已启动 (v${CONFIG.VERSION})`);
  }

  async restoreMonitorState() {
    // 检查是否需要恢复监控
    if (this.settings.isRunning) {
      this.logger.info('恢复监控状态...');
      this.isRunning = true;
      
      try {
        // 尝试获取现有标签页
        const tabs = await chrome.tabs.query({ url: this.settings.targetUrl });
        if (tabs.length > 0) {
          this.currentTabId = tabs[0].id;
          this.logger.info('已恢复标签页');
        } else {
          // 需要重新创建标签页
          this.logger.info('重新创建监控标签页...');
          this.currentTabId = await this.getOrCreateTab();
          await this.waitForTabLoad();
        }
        
        // 检查是否有下次检查时间，如果没有则立即调度
        if (!this.stats.nextCheckTime || this.stats.nextCheckTime < Date.now()) {
          // 上次检查时间已过，立即执行一次检查
          this.logger.info('执行延迟的检查...');
          setTimeout(() => this.performCheck(), 3000);
        } else {
          // 重新调度 alarm
          const remaining = this.stats.nextCheckTime - Date.now();
          const delayInMinutes = Math.max(remaining / 60000, 0.5);
          chrome.alarms.create('checkUpdate', { delayInMinutes });
          this.logger.info(`已恢复定时器，${Math.round(remaining/1000)} 秒后检查`);
        }
        
        this.logger.success('监控状态已恢复');
      } catch (e) {
        this.logger.error('恢复监控状态失败:', e.message);
      }
    }
  }

  async loadSettings() {
    const data = await this.storage.get('settings', {});
    this.settings = {
      targetUrl: data.targetUrl || '',
      webhookUrl: data.webhookUrl || '',
      refreshInterval: data.refreshInterval || CONFIG.DEFAULT_INTERVAL,
      antiCrawlerStrategy: data.antiCrawlerStrategy || 'random',
      userAgent: data.userAgent || 'edge',
      captchaSensitivity: data.captchaSensitivity || 'medium',
      maxRetries: data.maxRetries || CONFIG.MAX_RETRIES,
      notifyFormat: data.notifyFormat || 'markdown',
      isRunning: data.isRunning || false
    };

    // 初始化策略组件
    this.antiCrawler = new AntiCrawlerStrategy(this.settings);
    this.captchaDetector = new CaptchaDetector(this.settings.captchaSensitivity);
    
    if (this.settings.webhookUrl) {
      this.notifier = new NotificationService(this.settings.webhookUrl, this.settings.notifyFormat);
    }
  }

  async loadStats() {
    const data = await this.storage.get('stats', {});
    this.stats = { ...this.stats, ...data };
  }

  async saveStats() {
    await this.storage.set('stats', this.stats);
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // 验证消息格式
      if (!message || !message.action) {
        this.logger.warn('收到无效消息:', JSON.stringify(message));
        sendResponse({ success: false, error: '无效消息格式' });
        return true;
      }
      
      this.handleMessage(message, sender, sendResponse);
      return true;
    });
  }

  setupAlarmListener() {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'checkUpdate') {
        await this.performCheck();
      }
    });
  }

  setupTabListener() {
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (tabId === this.currentTabId) {
        this.logger.warn('监控标签页已关闭');
        this.currentTabId = null;
      }
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'startMonitor':
          const result = await this.startMonitor();
          sendResponse(result);
          break;
          
        case 'stopMonitor':
          await this.stopMonitor();
          sendResponse({ success: true });
          break;
          
        case 'pauseMonitor':
          this.isPaused = true;
          sendResponse({ success: true });
          break;
          
        case 'resumeMonitor':
          this.isPaused = false;
          sendResponse({ success: true });
          break;
          
        case 'testNotification':
          const testResult = await this.testNotification();
          sendResponse(testResult);
          break;
          
        case 'getStats':
          sendResponse({ success: true, stats: this.stats });
          break;
          
        case 'getLogs':
          sendResponse({ success: true, logs: this.logger.getRecent(100) });
          break;
          
        case 'clearLogs':
          this.logger.clear();
          sendResponse({ success: true });
          break;
          
        case 'clearData':
          await this.clearAllData();
          sendResponse({ success: true });
          break;
          
        case 'updateSettings':
          await this.updateSettings(message.settings);
          sendResponse({ success: true });
          break;
          
        case 'captchaHandled':
          await this.onCaptchaHandled();
          sendResponse({ success: true });
          break;
          
        case 'contentDetected':
          // content.js 发送的是 { items: [...], hasChanges: ... }
          const contentData = message.data;
          // 只在有变化时处理
          if (contentData?.hasChanges && contentData?.items?.length > 0) {
            await this.processContent(contentData.items);
          }
          sendResponse({ success: true });
          break;
          
        case 'captchaDetected':
          await this.onCaptchaDetected();
          sendResponse({ success: true });
          break;
          
        case 'fetchTestItems':
          const fetchResult = await this.fetchTestItems(message.url);
          sendResponse(fetchResult);
          break;
          
        default:
          sendResponse({ success: false, error: '未知操作' });
      }
    } catch (e) {
      this.logger.error('消息处理失败:', e.message + ' | ' + message.action);
      sendResponse({ success: false, error: e.message });
    }
  }

  async startMonitor() {
    try {
      // 重新加载设置以确保使用最新配置
      await this.loadSettings();
      
      // 验证设置
      if (!this.settings.targetUrl) {
        return { success: false, error: '未设置目标 URL' };
      }
      if (!this.settings.webhookUrl) {
        return { success: false, error: '未设置 Webhook' };
      }

      // 创建或获取标签页
      this.currentTabId = await this.getOrCreateTab();
      
      // 等待页面加载完成
      this.logger.info('等待页面加载...');
      await this.waitForTabLoad();
      
      // 更新状态
      this.isRunning = true;
      this.isPaused = false;
      this.stats.startTime = Date.now();
      
      await this.storage.set('settings', { ...this.settings, isRunning: true });
      await this.storage.set('captchaDetected', false);
      
      // 启动定时检查
      await this.scheduleNextCheck();
      
      // 延迟后执行首次检查
      setTimeout(() => this.performCheck(), 3000);
      
      this.logger.success('监控已启动', { url: this.settings.targetUrl });
      return { success: true };
      
    } catch (e) {
      this.logger.error('启动失败:', e.message);
      return { success: false, error: e.message };
    }
  }

  async stopMonitor() {
    this.isRunning = false;
    this.isPaused = false;
    
    this.stats.nextCheckTime = null;
    
    chrome.alarms.clear('checkUpdate');
    await this.storage.set('settings', { ...this.settings, isRunning: false });
    
    this.logger.info('监控已停止');
  }

  async getOrCreateTab() {
    const tabs = await chrome.tabs.query({ url: this.settings.targetUrl });
    
    if (tabs.length > 0) {
      return tabs[0].id;
    }
    
    const tab = await chrome.tabs.create({
      url: this.settings.targetUrl,
      active: false
    });
    
    return tab.id;
  }

  async scheduleNextCheck() {
    if (!this.isRunning || this.isPaused) {
      this.logger.warn('调度跳过: 监控未运行或已暂停');
      return;
    }
    
    const interval = this.antiCrawler.getRefreshInterval();
    const delayInMinutes = interval / 60;
    
    // 计算下次检查时间并保存
    this.stats.nextCheckTime = Date.now() + (interval * 1000);
    await this.saveStats();
    
    chrome.alarms.create('checkUpdate', {
      delayInMinutes: Math.max(delayInMinutes, 0.5)
    });
    
    this.logger.success(`已调度下次检查: ${Math.round(interval)} 秒后`);
  }

  async performCheck() {
    if (!this.isRunning || this.isPaused || !this.currentTabId) {
      this.logger.warn('检查跳过: 监控未运行或无标签页');
      return;
    }

    this.logger.info('开始检查更新...');
    
    try {
      // 检查页面状态，如果没有加载完成则等待
      try {
        const tab = await chrome.tabs.get(this.currentTabId);
        if (tab.status !== 'complete') {
          this.logger.info('等待页面加载...');
          await this.waitForTabLoad();
        }
      } catch (e) {
        this.logger.warn('获取标签页状态失败:', e.message);
      }
      
      // 额外等待动态内容
      await Utils.sleep(2000);
      
      // 更新统计
      this.stats.checkCount++;
      this.stats.lastCheck = Date.now();
      await this.saveStats();
      
      // 执行内容脚本
      this.logger.info('正在提取页面内容...');
      const results = await this.executeContentScript();
      this.logger.info(`内容提取完成: ${results.items?.length || 0} 条, 验证码: ${results.hasCaptcha}`);
      
      if (results.hasCaptcha) {
        await this.onCaptchaDetected();
        // 验证码检测后仍然调度下次检查
        await this.scheduleNextCheck();
        return;
      }
      
      if (results.items && results.items.length > 0) {
        await this.processContent(results.items);
      }
      
      // 刷新页面准备下次检查
      this.logger.info('正在刷新页面...');
      await this.refreshTab();
      this.logger.info('页面刷新完成');
      
    } catch (e) {
      this.logger.error('检查失败:', e.message);
      
      // 尝试恢复
      if (e.message.includes('No tab') || e.message.includes('Cannot access')) {
        await this.recoverTab();
      }
    }
    
    // 调度下次检查
    await this.scheduleNextCheck();
  }

  async waitForTabLoad(timeout = 30000) {
    if (!this.currentTabId) return;
    
    return new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === this.currentTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
      
      // 超时处理
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeout);
    });
  }

  async executeContentScript(tabId = null) {
    const targetTabId = tabId || this.currentTabId;
    
    if (!targetTabId) {
      return { hasCaptcha: false, items: [], error: '没有可用的标签页' };
    }
    
    // 先检查标签页是否存在且状态正常
    try {
      const tab = await chrome.tabs.get(targetTabId);
      if (!tab) {
        return { hasCaptcha: false, items: [], error: '标签页不存在' };
      }
      this.logger.info(`标签页状态: ${tab.status}, URL: ${tab.url?.substring(0, 50)}...`);
      
      // 如果页面还在加载，等待加载完成
      if (tab.status !== 'complete') {
        this.logger.info('页面正在加载，等待完成...');
        await this.waitForTabLoad(20000);
      }
    } catch (e) {
      this.logger.error('标签页检查失败:', e.message);
      return { hasCaptcha: false, items: [], error: '标签页不存在或已关闭: ' + e.message };
    }
    
    // 直接定义提取函数（在页面上下文中执行）
    const extractContent = () => {
      console.log('[SMZDM Monitor] 开始提取内容...');
      
      // 检测验证码
      const captchaKeywords = ['验证码', 'captcha', '安全验证', '人机验证', '滑动验证'];
      const captchaSelectors = ['.geetest', '.gt_slider', '#nc_1_wrapper', '[class*="captcha"]', '[id*="captcha"]'];
      
      let hasCaptcha = false;
      
      for (const selector of captchaSelectors) {
        if (document.querySelector(selector)) {
          console.log('[SMZDM Monitor] 检测到验证码元素:', selector);
          hasCaptcha = true;
          break;
        }
      }
      
      if (!hasCaptcha) {
        const pageText = document.body ? document.body.innerText.toLowerCase() : '';
        for (const keyword of captchaKeywords) {
          if (pageText.includes(keyword.toLowerCase())) {
            console.log('[SMZDM Monitor] 检测到验证码关键词:', keyword);
            hasCaptcha = true;
            break;
          }
        }
      }
      
      if (hasCaptcha) {
        return { hasCaptcha: true, items: [], debug: '验证码检测' };
      }
      
      // 多种选择器尝试
      const selectors = [
        '.pandect-content-common',
        '.feed-row-wide',
        '.z-feed-content',
        '[class*="feed-item"]',
        '.card'
      ];
      
      let containers = [];
      let usedSelector = '';
      
      for (const selector of selectors) {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          containers = found;
          usedSelector = selector;
          console.log(`[SMZDM Monitor] 使用选择器: ${selector}, 找到 ${found.length} 个元素`);
          break;
        }
      }
      
      if (containers.length === 0) {
        // 返回页面结构信息用于调试
        const bodyClasses = document.body?.className || '无';
        const mainContent = document.querySelector('main') || document.querySelector('#main') || document.querySelector('.main');
        const debugInfo = {
          bodyClasses,
          hasMain: !!mainContent,
          mainClasses: mainContent?.className || '无',
          pageHTML: document.body?.innerHTML?.substring(0, 500) || '空'
        };
        console.log('[SMZDM Monitor] 未找到内容容器，调试信息:', debugInfo);
        return { hasCaptcha: false, items: [], debug: '未找到内容容器', debugInfo };
      }
      
      // 提取内容
      const items = [];
      
      containers.forEach((container, index) => {
        try {
          // 尝试多种标题选择器
          const titleElem = container.querySelector('.pandect-content-title a') ||
                           container.querySelector('.feed-block-title a') ||
                           container.querySelector('a[title]') ||
                           container.querySelector('h3 a') ||
                           container.querySelector('h2 a');
          
          if (!titleElem) return;
          
          const priceElem = container.querySelector('.pandect-content-detail .price') ||
                           container.querySelector('.z-price') ||
                           container.querySelector('.price');
          
          const timeElem = container.querySelector('.pandect-content-time') ||
                          container.querySelector('.feed-time') ||
                          container.querySelector('time');
          
          const imgElem = container.querySelector('.pandect-content-img img') ||
                         container.querySelector('img');
          
          const linkElem = titleElem;
          const sourceElem = container.querySelector('.z-feed-foot-l .source') ||
                            container.querySelector('.source');
          
          const link = linkElem ? linkElem.href : '';
          let id = 'item-' + index;
          if (link) {
            const match = link.match(/\/p\/(\d+)/);
            if (match) id = match[1];
            else id = link;
          }
          
          items.push({
            id: id,
            title: titleElem.textContent.trim(),
            price: priceElem ? priceElem.textContent.trim() : '未知',
            time: timeElem ? timeElem.textContent.trim() : '未知',
            image: imgElem ? imgElem.src : '',
            link: link,
            source: sourceElem ? sourceElem.textContent.trim() : '未知',
            extractedAt: Date.now()
          });
        } catch (e) {
          console.error('[SMZDM Monitor] 提取失败:', e);
        }
      });
      
      console.log(`[SMZDM Monitor] 提取完成: ${items.length} 条`);
      return { hasCaptcha: false, items: items, debug: `使用选择器: ${usedSelector}` };
    };
    
    // 增加超时时间到 30 秒
    const timeout = 30000;
    let timeoutId;
    
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('内容提取超时(30s)')), timeout);
    });
    
    try {
      // 再次检查标签页是否有效
      const tab = await chrome.tabs.get(targetTabId);
      if (!tab || tab.status === 'unloaded') {
        return { hasCaptcha: false, items: [], error: '标签页已关闭' };
      }
      
      const executePromise = chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: extractContent
      });
      
      const results = await Promise.race([executePromise, timeoutPromise]);
      clearTimeout(timeoutId);
      
      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        
        // 记录调试信息
        if (result.debug) {
          this.logger.info(`提取调试: ${result.debug}`);
        }
        if (result.debugInfo) {
          this.logger.warn('页面结构信息:', JSON.stringify(result.debugInfo).substring(0, 200));
        }
        
        return result;
      } else {
        this.logger.error('脚本返回结果为空');
        return { hasCaptcha: false, items: [], error: '结果为空' };
      }
    } catch (e) {
      clearTimeout(timeoutId);
      
      // 特殊处理连接错误
      if (e.message && e.message.includes('Could not establish connection')) {
        this.logger.error('连接失败: 标签页可能已关闭或正在导航中');
        return { hasCaptcha: false, items: [], error: '连接失败，标签页可能已关闭' };
      }
      
      this.logger.error('脚本执行失败: ' + (e.message || e));
      return { hasCaptcha: false, items: [], error: e.message };
    }
  }

  async processContent(items) {
    if (!items || items.length === 0) return;
    
    const lastItems = await this.storage.get('lastItems', []);
    const lastIds = new Set(lastItems.map(item => item.id));
    const newItems = items.filter(item => !lastIds.has(item.id));
    
    if (newItems.length > 0) {
      this.logger.success(`发现 ${newItems.length} 条新爆料！`);
      
      // 更新统计
      this.stats.newCount += newItems.length;
      await this.saveStats();
      
      // 发送通知
      await this.sendNotification(newItems);
    } else {
      this.logger.info('内容无变化');
    }
    
    // 保存当前内容
    await this.storage.set('lastItems', items);
  }

  async sendNotification(items) {
    if (!this.notifier) {
      this.notifier = new NotificationService(this.settings.webhookUrl, this.settings.notifyFormat);
    }
    
    try {
      await this.notifier.send(items);
      this.logger.success('通知发送成功');
    } catch (e) {
      this.logger.error('通知发送失败:', e.message);
    }
  }

  async refreshTab() {
    if (!this.currentTabId) return;
    
    try {
      // 添加随机延迟模拟人类行为
      const delay = this.antiCrawler.getBehaviorDelay();
      this.logger.info(`等待 ${Math.round(delay/1000)} 秒后刷新...`);
      await Utils.sleep(delay);
      
      await chrome.tabs.reload(this.currentTabId, { bypassCache: true });
      this.logger.info('页面已刷新，等待加载...');
      
      // 等待页面加载完成
      await this.waitForTabLoad();
      this.logger.info('页面加载完成');
    } catch (e) {
      this.logger.error('刷新失败:', e.message);
    }
  }

  async recoverTab() {
    this.logger.info('尝试恢复监控标签页...');
    
    try {
      this.currentTabId = await this.getOrCreateTab();
      this.logger.success('标签页已恢复');
    } catch (e) {
      this.logger.error('恢复失败:', e.message);
    }
  }

  async onCaptchaDetected() {
    this.logger.warn('⚠️ 检测到验证码！');
    
    this.stats.captchaCount++;
    await this.saveStats();
    await this.storage.set('captchaDetected', true);
    
    // 停止自动检查
    chrome.alarms.clear('checkUpdate');
    
    // 发送警报
    if (this.notifier) {
      await this.notifier.sendCaptchaAlert();
    }
  }

  async onCaptchaHandled() {
    this.logger.info('验证码已处理');
    await this.storage.set('captchaDetected', false);
    
    if (this.isRunning) {
      // 等待冷却期后恢复
      setTimeout(() => {
        this.scheduleNextCheck();
      }, CONFIG.CAPTCHA_COOLDOWN);
    }
  }

  async testNotification() {
    if (!this.settings.webhookUrl) {
      return { success: false, error: '未配置 Webhook' };
    }
    
    const notifier = new NotificationService(this.settings.webhookUrl, this.settings.notifyFormat);
    const success = await notifier.sendTestNotification();
    
    return success 
      ? { success: true } 
      : { success: false, error: '发送失败' };
  }

  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await this.storage.set('settings', this.settings);
    
    // 更新组件
    this.antiCrawler = new AntiCrawlerStrategy(this.settings);
    this.captchaDetector = new CaptchaDetector(this.settings.captchaSensitivity);
    this.notifier = new NotificationService(this.settings.webhookUrl, this.settings.notifyFormat);
    
    this.logger.info('设置已更新');
  }

  async clearAllData() {
    await this.storage.clear();
    this.stats = {
      checkCount: 0,
      newCount: 0,
      captchaCount: 0,
      startTime: null,
      lastCheck: null,
      nextCheckTime: null
    };
    this.logger.clear();
    this.logger.info('数据已清除');
  }

  async fetchTestItems(url) {
    let testTabId = null;
    
    try {
      // 检查 webhook 配置
      await this.loadSettings();
      if (!this.settings.webhookUrl) {
        return { success: false, error: '未配置企微机器人 Webhook', items: [] };
      }
      
      // 创建临时标签页
      this.logger.info('正在创建测试标签页...');
      const tab = await chrome.tabs.create({
        url: url,
        active: false
      });
      testTabId = tab.id;
      
      // 等待页面加载完成（使用 Promise + 超时）
      const loadTimeout = 20000; // 20秒超时
      await new Promise((resolve) => {
        let resolved = false;
        const cleanup = () => {
          if (!resolved) {
            resolved = true;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        
        const listener = (tabId, info) => {
          if (tabId === testTabId && info.status === 'complete') {
            this.logger.info('测试页面加载完成');
            cleanup();
          }
        };
        
        chrome.tabs.onUpdated.addListener(listener);
        
        // 超时处理
        setTimeout(() => {
          this.logger.warn('页面加载超时，继续尝试提取...');
          cleanup();
        }, loadTimeout);
      });
      
      // 额外等待确保动态内容加载
      await Utils.sleep(3000);
      
      // 再次检查标签页是否存在
      try {
        const currentTab = await chrome.tabs.get(testTabId);
        if (!currentTab) {
          return { success: false, error: '标签页意外关闭', items: [] };
        }
        this.logger.info(`当前标签页状态: ${currentTab.status}`);
      } catch (e) {
        return { success: false, error: '标签页已关闭: ' + e.message, items: [] };
      }
      
      // 执行内容提取
      const results = await this.executeContentScript(testTabId);
      
      // 关闭临时标签页
      if (testTabId) {
        await chrome.tabs.remove(testTabId);
      }
      
      if (results.hasCaptcha) {
        return { success: false, error: '检测到验证码，请稍后重试', items: [] };
      }
      
      const items = results.items || [];
      
      // 发送通知到企微
      if (items.length > 0) {
        await this.sendTestFetchNotification(items);
      }
      
      return { success: true, items: items, count: items.length };
      
    } catch (e) {
      // 确保关闭标签页
      if (testTabId) {
        try {
          await chrome.tabs.remove(testTabId);
        } catch (err) {
          // 忽略关闭错误
        }
      }
      
      this.logger.error('测试抓取失败:', e.message);
      return { success: false, error: e.message, items: [] };
    }
  }

  async sendTestFetchNotification(items) {
    const notifier = new NotificationService(this.settings.webhookUrl, this.settings.notifyFormat);
    
    const content = {
      msgtype: 'markdown',
      markdown: {
        content: `## 🧪 测试抓取结果\n\n` +
                 `⏰ 抓取时间: ${Utils.formatTime()}\n` +
                 `📊 抓取数量: **${items.length}** 条\n\n` +
                 `---\n\n` +
                 items.slice(0, 10).map((item, i) => 
                   `**${i + 1}. ${item.title}**\n` +
                   `> 💰 价格: ${item.price}\n` +
                   `> ⏰ 时间: ${item.time}\n` +
                   `> 🔗 [查看详情](${item.link})`
                 ).join('\n\n') +
                 (items.length > 10 ? `\n\n... 还有 ${items.length - 10} 条` : '') +
                 `\n\n---\n*由 SMZDM 爆料监控器 测试抓取推送*`
      }
    };

    try {
      const response = await fetch(this.settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content)
      });
      
      const result = await response.json();
      if (result.errcode === 0) {
        this.logger.success('测试抓取通知已发送到企微');
      } else {
        this.logger.error('通知发送失败:', result.errmsg);
      }
    } catch (e) {
      this.logger.error('通知发送异常:', e.message);
    }
  }
}

// ==================== 初始化 ====================
const monitor = new SMZDMMonitor();