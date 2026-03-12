// SMZDM 爆料监控器 - Content Script
// 版本 1.20.0 - 最终优化版本

(function() {
  'use strict';

  // ==================== 配置 ====================
  const CONFIG = {
    VERSION: '1.22.1',
    CHECK_INTERVAL: 30000,  // 改为 30 秒检测一次
    CAPTCHA_SELECTORS: [
      '.geetest',
      '.gt_slider',
      '#nc_1_wrapper',
      '[class*="captcha-verify"]',
      '[class*="captcha"]',
      '[id*="captcha"]',
      '[id*="verify"]',
      '.nc-container',
      '.secsdk-captcha'
    ],
    CAPTCHA_KEYWORDS: [
      '验证码',
      'captcha',
      '安全验证',
      '人机验证',
      '滑动验证',
      '请完成验证',
      '异常访问',
      '访问频繁'
    ]
  };

  // ==================== 工具函数 ====================
  const Utils = {
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    hash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(16);
    },

    sanitizeText(text) {
      if (!text) return '';
      return text.trim().replace(/\s+/g, ' ');
    },

    extractId(link) {
      if (!link) return null;
      const match = link.match(/\/p\/(\d+)/);
      return match ? match[1] : this.hash(link);
    }
  };

  // ==================== 验证码检测器 ====================
  class CaptchaDetector {
    constructor(sensitivity = 'medium') {
      this.sensitivity = sensitivity;
      this.detected = false;
      this.lastCheck = 0;
    }

    check() {
      const now = Date.now();
      if (now - this.lastCheck < 500) {
        return this.detected;
      }
      this.lastCheck = now;

      // 检测选择器
      for (const selector of CONFIG.CAPTCHA_SELECTORS) {
        const elem = document.querySelector(selector);
        if (elem && elem.offsetParent !== null) {
          this.detected = true;
          console.log('[SMZDM Monitor] 检测到验证码元素:', selector);
          return true;
        }
      }

      // 检测关键词
      const pageText = document.body.innerText.toLowerCase();
      const pageHTML = document.body.innerHTML.toLowerCase();
      
      for (const keyword of CONFIG.CAPTCHA_KEYWORDS) {
        if (pageText.includes(keyword.toLowerCase()) || 
            pageHTML.includes(keyword.toLowerCase())) {
          this.detected = true;
          console.log('[SMZDM Monitor] 检测到验证码关键词:', keyword);
          return true;
        }
      }

      // 检测特定验证码类型
      if (this.detectGeetest() || this.detectAliCaptcha() || this.detectTencentCaptcha()) {
        this.detected = true;
        return true;
      }

      this.detected = false;
      return false;
    }

    detectGeetest() {
      // 极验验证码
      return document.querySelector('.geetest_slider_button') !== null ||
             document.querySelector('.geetest_verify') !== null;
    }

    detectAliCaptcha() {
      // 阿里验证码
      return document.querySelector('#nc_1_wrapper') !== null ||
             document.querySelector('.nc-container') !== null;
    }

    detectTencentCaptcha() {
      // 腾讯验证码
      return document.querySelector('#TencentCaptcha') !== null ||
             document.querySelector('[id*="Tencent"]') !== null;
    }

    reset() {
      this.detected = false;
    }
  }

  // ==================== 内容提取器 ====================
  class ContentExtractor {
    constructor() {
      this.lastItems = [];
      this.lastHash = '';
    }

    extract() {
      const items = [];
      const containers = document.querySelectorAll('.pandect-content-common');

      containers.forEach((container, index) => {
        try {
          const item = this.extractItem(container, index);
          if (item && item.title) {
            items.push(item);
          }
        } catch (e) {
          console.error('[SMZDM Monitor] 提取项目失败:', e);
        }
      });

      return items;
    }

    extractItem(container, index) {
      const titleElem = container.querySelector('.pandect-content-title a');
      const priceElem = container.querySelector('.pandect-content-detail .price');
      const timeElem = container.querySelector('.pandect-content-time');
      const imgElem = container.querySelector('.pandect-content-img img');
      const linkElem = container.querySelector('.pandect-content-title a');
      const sourceElem = container.querySelector('.z-feed-foot-l .source');
      const likesElem = container.querySelector('.zhi span');
      const commentsElem = container.querySelector('.icon-comment-o-thin + span');

      if (!titleElem) return null;

      const link = linkElem ? linkElem.href : '';
      
      return {
        id: Utils.extractId(link) || `item-${Date.now()}-${index}`,
        title: Utils.sanitizeText(titleElem.textContent),
        price: Utils.sanitizeText(priceElem ? priceElem.textContent : '未知价格'),
        time: Utils.sanitizeText(timeElem ? timeElem.textContent : '未知时间'),
        image: imgElem ? imgElem.src : '',
        link: link,
        source: Utils.sanitizeText(sourceElem ? sourceElem.textContent : '未知'),
        likes: likesElem ? parseInt(likesElem.textContent) || 0 : 0,
        comments: commentsElem ? parseInt(commentsElem.textContent) || 0 : 0,
        extractedAt: Date.now()
      };
    }

    hasChanges(items) {
      const currentHash = this.calculateHash(items);
      if (currentHash !== this.lastHash) {
        this.lastHash = currentHash;
        return true;
      }
      return false;
    }

    calculateHash(items) {
      const ids = items.map(i => i.id).join(',');
      return Utils.hash(ids);
    }
  }

  // ==================== 内容监控器 ====================
  class ContentMonitor {
    constructor() {
      this.captchaDetector = new CaptchaDetector();
      this.contentExtractor = new ContentExtractor();
      this.isRunning = false;
      this.checkInterval = null;
      this.observer = null;
      
      this.init();
    }

    init() {
      console.log(`[SMZDM Monitor] 内容脚本已加载 (v${CONFIG.VERSION})`);
      
      // 等待页面加载完成
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.start());
      } else {
        this.start();
      }
    }

    start() {
      this.isRunning = true;
      
      // 不再设置定时检查，完全由 background.js 控制
      // 初始检查也取消，等待 background 触发
      
      // 设置 MutationObserver 监听 DOM 变化（用于验证码检测）
      this.setupObserver();
      
      console.log('[SMZDM Monitor] 监控已启动，等待后台指令');
    }

    setupObserver() {
      const targetNode = document.querySelector('.cont-left') || document.body;
      
      const config = {
        childList: true,
        subtree: true,
        characterData: false,
        attributes: false
      };

      this.observer = new MutationObserver((mutations) => {
        // 只检测验证码，不主动触发内容检测
        if (this.captchaDetector.check()) {
          this.notifyBackground('captchaDetected', { hasCaptcha: true });
        }
      });

      this.observer.observe(targetNode, config);
    }

    performCheck() {
      // 检测验证码
      if (this.captchaDetector.check()) {
        this.notifyBackground('captchaDetected', { hasCaptcha: true });
        return;
      }

      // 提取内容
      const items = this.contentExtractor.extract();
      
      // 只在有变化时通知后台
      if (items.length > 0 && this.contentExtractor.hasChanges(items)) {
        this.notifyBackground('contentDetected', {
          items: items,
          hasChanges: true
        });
      }
    }

    async notifyBackground(action, data) {
      try {
        await chrome.runtime.sendMessage({
          action: action,
          data: data
        });
      } catch (e) {
        // 扩展可能已关闭或重新加载
        console.error('[SMZDM Monitor] 通知后台失败:', e);
      }
    }

    stop() {
      this.isRunning = false;
      
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
      
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      
      console.log('[SMZDM Monitor] 监控已停止');
    }
  }

  // ==================== 启动 ====================
  const monitor = new ContentMonitor();

  // 监听来自后台的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ status: 'ok', version: CONFIG.VERSION });
    } else if (message.action === 'forceCheck') {
      monitor.performCheck();
      sendResponse({ status: 'ok' });
    } else if (message.action === 'stop') {
      monitor.stop();
      sendResponse({ status: 'ok' });
    }
    return true;
  });

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    monitor.stop();
  });

})();