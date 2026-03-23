// SMZDM 爆料监控器 - Popup 控制脚本
// 版本 1.23.0 - 多发送器支持版本

class PopupController {
  constructor() {
    this.version = chrome.runtime.getManifest().version;
    this.settings = {};
    this.stats = {};
    this.updateInterval = null;
    this.progressIntervalId = null;
    this.progressDuration = 0;
    this.nextCheckTime = null;
    this.availableSenders = [];
    this.editingSenderId = null; // 当前编辑的发送器 ID

    this.init();
  }

  async init() {
    // 设置版本号显示
    document.getElementById('versionText').textContent = `v${this.version}`;

    await this.loadAvailableSenders();
    await this.loadSettings();
    await this.loadStats();
    await this.loadLogs(true);
    this.bindEvents();
    this.updateUI();
    this.startPolling();
    this.addLog('info', `插件已加载 (v${this.version})`);
  }

  async loadAvailableSenders() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSenders' });
      if (response && response.success && response.senders) {
        this.availableSenders = response.senders;
        this.renderSenderTypeOptions();
      } else {
        this.addLog('error', '加载发送器列表失败: 响应格式错误');
      }
    } catch (e) {
      this.addLog('error', '加载发送器列表失败: ' + e.message);
    }
  }

  renderSenderTypeOptions() {
    const select = document.getElementById('modalSenderType');
    select.innerHTML = this.availableSenders.map(sender =>
      `<option value="${sender.name}">${sender.icon} ${sender.displayName}</option>`
    ).join('');
  }

  /**
   * 渲染发送器列表
   */
  renderSendersList() {
    const container = document.getElementById('sendersList');

    if (!this.settings.senders || this.settings.senders.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📤</div>
          <div class="empty-state-text">暂无发送器，点击下方按钮添加</div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.settings.senders.map(senderConfig => {
      const senderInfo = this.availableSenders.find(s => s.name === senderConfig.type);
      // 如果找不到发送器信息（可能是新版本移除了该类型），显示警告
      if (!senderInfo) {
        return `
          <div class="sender-card disabled" data-id="${senderConfig.id}">
            <div class="sender-header">
              <div class="sender-info">
                <span class="sender-icon">❓</span>
                <div>
                  <div class="sender-name">未知发送器 (${senderConfig.type})</div>
                  <span class="sender-status disabled">不可用</span>
                </div>
              </div>
              <div class="sender-actions">
                <button class="danger delete-sender-btn" data-id="${senderConfig.id}">删除</button>
              </div>
            </div>
          </div>
        `;
      }

      const statusClass = senderConfig.enabled ? '' : 'disabled';
      const statusText = senderConfig.enabled ? '已启用' : '已禁用';

      return `
        <div class="sender-card ${statusClass}" data-id="${senderConfig.id}">
          <div class="sender-header">
            <div class="sender-info">
              <span class="sender-icon">${senderInfo.icon}</span>
              <div>
                <div class="sender-name">${senderInfo.displayName}</div>
                <span class="sender-status ${statusClass}">${statusText}</span>
              </div>
            </div>
            <div class="sender-actions">
              <button class="secondary edit-sender-btn" data-id="${senderConfig.id}">编辑</button>
              <button class="danger delete-sender-btn" data-id="${senderConfig.id}">删除</button>
            </div>
          </div>
          <div class="sender-toggle">
            <span class="sender-toggle-label">启用此发送器</span>
            <label class="switch">
              <input type="checkbox" class="toggle-sender-checkbox" data-id="${senderConfig.id}" ${senderConfig.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        </div>
      `;
    }).join('');

    // 绑定发送器卡片事件
    this.bindSenderCardEvents();
  }

  /**
   * 绑定发送器卡片事件
   */
  bindSenderCardEvents() {
    // 编辑按钮
    document.querySelectorAll('.edit-sender-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        this.showEditSenderModal(id);
      });
    });

    // 删除按钮
    document.querySelectorAll('.delete-sender-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        this.deleteSender(id);
      });
    });

    // 启用开关
    document.querySelectorAll('.toggle-sender-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        this.toggleSender(id, e.target.checked);
      });
    });
  }

  /**
   * 显示添加发送器弹窗
   */
  async showAddSenderModal() {
    // 如果发送器列表为空，尝试重新加载
    if (this.availableSenders.length === 0) {
      await this.loadAvailableSenders();
    }

    if (this.availableSenders.length === 0) {
      this.showToast('发送器列表未加载，请稍后重试', 'warning');
      return;
    }

    this.editingSenderId = null;
    document.getElementById('modalTitle').textContent = '添加发送器';
    document.getElementById('modalSenderType').disabled = false;
    document.getElementById('modalSenderType').value = this.availableSenders[0]?.name || '';
    this.renderModalSenderConfig(this.availableSenders[0]?.name, {});
    // 隐藏删除按钮
    document.getElementById('deleteSenderInModalBtn').style.display = 'none';
    document.getElementById('senderModal').style.display = 'flex';
  }

  /**
   * 显示编辑发送器弹窗
   */
  showEditSenderModal(id) {
    const senderConfig = this.settings.senders.find(s => s.id === id);
    if (!senderConfig) return;

    this.editingSenderId = id;
    document.getElementById('modalTitle').textContent = '编辑发送器';
    document.getElementById('modalSenderType').value = senderConfig.type;
    document.getElementById('modalSenderType').disabled = true; // 编辑时不可更改类型
    this.renderModalSenderConfig(senderConfig.type, senderConfig.config);
    // 显示删除按钮
    document.getElementById('deleteSenderInModalBtn').style.display = 'block';
    document.getElementById('senderModal').style.display = 'flex';
  }

  /**
   * 关闭发送器弹窗
   */
  closeSenderModal() {
    document.getElementById('senderModal').style.display = 'none';
    this.editingSenderId = null;
  }

  /**
   * 渲染弹窗中的发送器配置表单
   */
  renderModalSenderConfig(senderType, config = {}) {
    const container = document.getElementById('modalSenderConfig');
    const senderInfo = this.availableSenders.find(s => s.name === senderType);

    if (!senderInfo || !senderInfo.configFields || senderInfo.configFields.length === 0) {
      container.innerHTML = '<div class="help-text">该发送器无需配置</div>';
      return;
    }

    container.innerHTML = senderInfo.configFields.map(field => {
      const value = config[field.key] ?? field.default ?? '';

      switch (field.type) {
        case 'text':
          return `
            <div class="form-group">
              <label>${field.label}${field.required ? ' *' : ''}</label>
              <input type="text" id="modal_${field.key}" placeholder="${field.placeholder || ''}" value="${this.escapeHtml(value)}">
              ${field.help ? `<div class="help-text">${field.help}</div>` : ''}
            </div>
          `;

        case 'password':
          // 密码字段：显示 placeholder 表示已保存，值为空让用户重新输入
          // 如果已有值，显示提示文字
          const passwordPlaceholder = value ? '•••••••• (已保存，留空保持不变)' : (field.placeholder || '');
          return `
            <div class="form-group">
              <label>${field.label}${field.required ? ' *' : ''}</label>
              <input type="password" id="modal_${field.key}" placeholder="${passwordPlaceholder}" value="">
              ${field.help ? `<div class="help-text">${field.help}</div>` : ''}
            </div>
          `;

        case 'select':
          return `
            <div class="form-group">
              <label>${field.label}</label>
              <select id="modal_${field.key}">
                ${field.options.map(opt => `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`).join('')}
              </select>
            </div>
          `;

        case 'checkbox':
          return `
            <div class="switch-container">
              <div>
                <span class="switch-label">${field.label}</span>
                ${field.help ? `<div class="help-text" style="margin-top: 2px">${field.help}</div>` : ''}
              </div>
              <label class="switch">
                <input type="checkbox" id="modal_${field.key}" ${value ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          `;

        default:
          console.warn(`未知的配置字段类型: ${field.type}`);
          return `
            <div class="form-group">
              <label>${field.label}</label>
              <input type="text" id="modal_${field.key}" value="${this.escapeHtml(value)}">
            </div>
          `;
      }
    }).join('');
  }

  /**
   * 获取弹窗中的发送器配置
   */
  getModalSenderConfig() {
    const senderType = document.getElementById('modalSenderType').value;
    const senderInfo = this.availableSenders.find(s => s.name === senderType);
    const config = {};

    if (senderInfo && senderInfo.configFields) {
      senderInfo.configFields.forEach(field => {
        const elem = document.getElementById(`modal_${field.key}`);
        if (elem) {
          if (field.type === 'checkbox') {
            config[field.key] = elem.checked;
          } else {
            const value = elem.value.trim();
            // 对于密码字段，如果为空且是编辑模式，保留原值
            if (field.type === 'password' && !value && this.editingSenderId) {
              const existingSender = this.settings.senders.find(s => s.id === this.editingSenderId);
              if (existingSender && existingSender.config[field.key]) {
                config[field.key] = existingSender.config[field.key];
              } else {
                config[field.key] = '';
              }
            } else {
              config[field.key] = value;
            }
          }
        }
      });
    }

    return { type: senderType, config };
  }

  /**
   * 保存发送器
   */
  async saveSender() {
    const { type, config } = this.getModalSenderConfig();
    const senderInfo = this.availableSenders.find(s => s.name === type);

    // 验证必填字段
    if (senderInfo && senderInfo.configFields) {
      const missingFields = [];
      senderInfo.configFields.forEach(field => {
        if (field.required) {
          const value = config[field.key];
          if (value === undefined || value === null || value === '') {
            missingFields.push(field.label || field.key);
          }
        }
      });

      if (missingFields.length > 0) {
        this.showToast(`请填写: ${missingFields.join(', ')}`, 'warning');
        return;
      }
    }

    if (this.editingSenderId) {
      // 编辑模式
      const index = this.settings.senders.findIndex(s => s.id === this.editingSenderId);
      if (index !== -1) {
        this.settings.senders[index].config = config;
      }
    } else {
      // 添加模式
      const newSender = {
        id: 'sender-' + Date.now(),
        type: type,
        enabled: true,
        config: config
      };
      this.settings.senders.push(newSender);
    }

    await this.saveSettings();
    this.renderSendersList();
    this.closeSenderModal();
    this.showToast('发送器已保存', 'success');
  }

  /**
   * 删除发送器
   */
  async deleteSender(id) {
    if (!confirm('确定要删除此发送器吗？')) {
      return;
    }

    this.settings.senders = this.settings.senders.filter(s => s.id !== id);
    await this.saveSettings();
    this.renderSendersList();
    this.showToast('发送器已删除', 'success');
  }

  /**
   * 在编辑弹窗中删除发送器
   */
  async deleteSenderInModal() {
    if (!this.editingSenderId) return;

    if (!confirm('确定要删除此发送器吗？')) {
      return;
    }

    this.settings.senders = this.settings.senders.filter(s => s.id !== this.editingSenderId);
    await this.saveSettings();
    this.closeSenderModal();
    this.renderSendersList();
    this.showToast('发送器已删除', 'success');
  }

  /**
   * 切换发送器启用状态
   */
  async toggleSender(id, enabled) {
    const sender = this.settings.senders.find(s => s.id === id);
    if (sender) {
      sender.enabled = enabled;
      await this.saveSettings();
      this.renderSendersList();
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      const data = result.settings || {};

      // 数据迁移：将旧的 sender 格式转换为 senders 数组
      let senders = data.senders || null;
      let needsMigration = false;

      if (!senders && data.sender) {
        senders = [{
          id: 'migrated-' + Date.now(),
          type: data.sender.type || 'wecom',
          enabled: data.sender.enabled !== false,
          config: data.sender.config || {}
        }];
        needsMigration = true;
      } else if (!senders && data.webhookUrl) {
        senders = [{
          id: 'migrated-legacy-' + Date.now(),
          type: 'wecom',
          enabled: true,
          config: {
            webhookUrl: data.webhookUrl,
            format: data.notifyFormat || 'markdown',
            mentionAll: true
          }
        }];
        needsMigration = true;
      }

      this.settings = {
        targetUrl: data.targetUrl || '',
        senders: senders || [],
        refreshInterval: data.refreshInterval || 60,
        antiCrawlerStrategy: data.antiCrawlerStrategy || 'random',
        captchaSensitivity: data.captchaSensitivity || 'medium',
        maxRetries: data.maxRetries || 5,
        debugMode: data.debugMode || false,
        isRunning: data.isRunning || false
      };

      // 保存迁移后的设置，清理旧字段
      if (needsMigration) {
        const cleanedSettings = { ...this.settings };
        await chrome.storage.local.set({ settings: cleanedSettings });
        this.addLog('info', '数据迁移完成');
      }

      // 填充基本设置表单
      document.getElementById('targetUrl').value = this.settings.targetUrl || '';
      document.getElementById('refreshInterval').value = this.settings.refreshInterval || 60;
      document.getElementById('antiCrawlerStrategy').value = this.settings.antiCrawlerStrategy || 'random';
      document.getElementById('captchaSensitivity').value = this.settings.captchaSensitivity || 'medium';
      document.getElementById('maxRetries').value = this.settings.maxRetries || 5;
      document.getElementById('debugMode').checked = this.settings.debugMode || false;

      // 渲染发送器列表
      this.renderSendersList();

    } catch (e) {
      this.addLog('error', '加载设置失败: ' + e.message);
    }
  }

  /**
   * 转义 HTML 特殊字符
   * 包括双引号转义，确保在 HTML 属性中安全使用
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    // 额外转义双引号，确保在 HTML 属性中使用时安全
    return div.innerHTML.replace(/"/g, '&quot;');
  }

  async loadStats() {
    try {
      const result = await chrome.storage.local.get(['stats']);
      const defaultStats = {
        checkCount: 0,
        newCount: 0,
        captchaCount: 0,
        startTime: null,
        lastCheck: null,
        nextCheckTime: null,
        scheduledInterval: null
      };
      this.stats = { ...defaultStats, ...(result.stats || {}) };
      
      this.updateStatsUI();
    } catch (e) {
      this.addLog('error', '加载统计失败: ' + e.message);
    }
  }

  bindEvents() {
    // 标签页切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // 主按钮
    document.getElementById('startBtn').addEventListener('click', () => this.startMonitor());
    document.getElementById('stopBtn').addEventListener('click', () => this.stopMonitor());

    // 高级设置按钮
    document.getElementById('clearDataBtn').addEventListener('click', () => this.clearData());
    document.getElementById('clearLogsBtn').addEventListener('click', () => this.clearLogs());
    document.getElementById('testBtn').addEventListener('click', () => this.testNotification());

    // 测试抓取按钮
    document.getElementById('fetchTestBtn').addEventListener('click', () => this.fetchTestItems());
    document.getElementById('closeResultsBtn').addEventListener('click', () => this.closeFetchResults());

    // 发送器管理按钮
    document.getElementById('addSenderBtn').addEventListener('click', () => this.showAddSenderModal());
    document.getElementById('closeModalBtn').addEventListener('click', () => this.closeSenderModal());
    document.getElementById('cancelSenderBtn').addEventListener('click', () => this.closeSenderModal());
    document.getElementById('saveSenderBtn').addEventListener('click', () => this.saveSender());
    document.getElementById('deleteSenderInModalBtn').addEventListener('click', () => this.deleteSenderInModal());

    // 弹窗中的发送器类型切换
    document.getElementById('modalSenderType').addEventListener('change', (e) => {
      this.renderModalSenderConfig(e.target.value, {});
    });

    // 设置变更自动保存
    const inputs = document.querySelectorAll('#basic input, #basic select, #advanced input, #advanced select');
    inputs.forEach(input => {
      input.addEventListener('change', () => this.saveSettings());
      input.addEventListener('blur', () => this.saveSettings());
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.saveSettings();
        }
      });
    });

    // 点击弹窗背景关闭
    document.getElementById('senderModal').addEventListener('click', (e) => {
      if (e.target.id === 'senderModal') {
        this.closeSenderModal();
      }
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
  }

  async saveSettings() {
    // 确保 senders 已初始化
    if (!this.settings.senders) {
      this.settings.senders = [];
    }

    const newSettings = {
      targetUrl: document.getElementById('targetUrl').value.trim(),
      senders: this.settings.senders,
      refreshInterval: parseInt(document.getElementById('refreshInterval').value) || 60,
      antiCrawlerStrategy: document.getElementById('antiCrawlerStrategy').value,
      captchaSensitivity: document.getElementById('captchaSensitivity').value,
      maxRetries: parseInt(document.getElementById('maxRetries').value) || 5,
      debugMode: document.getElementById('debugMode').checked,
      isRunning: this.settings.isRunning || false
    };

    // 更新本地设置
    this.settings = newSettings;

    try {
      await chrome.storage.local.set({ settings: this.settings });
      this.addLog('info', '设置已保存');

      // 通知后台更新设置（始终通知，确保数据同步）
      await chrome.runtime.sendMessage({ action: 'updateSettings', settings: this.settings });
    } catch (e) {
      this.addLog('error', '保存设置失败: ' + e.message);
    }
  }

  async startMonitor() {
    const targetUrl = document.getElementById('targetUrl').value.trim();

    if (!targetUrl) {
      this.showToast('请输入博主页面 URL', 'warning');
      return;
    }

    // 确保发送器列表已加载
    if (this.availableSenders.length === 0) {
      await this.loadAvailableSenders();
    }

    // 检查是否有启用的发送器
    const enabledSenders = this.settings.senders?.filter(s => s.enabled) || [];
    if (enabledSenders.length === 0) {
      this.showToast('请至少启用一个发送器', 'warning');
      return;
    }

    // 验证启用的发送器配置
    for (const senderConfig of enabledSenders) {
      const senderInfo = this.availableSenders.find(s => s.name === senderConfig.type);
      if (senderInfo && senderInfo.configFields) {
        const missingFields = [];
        senderInfo.configFields.forEach(field => {
          if (field.required) {
            const value = senderConfig.config[field.key];
            if (value === undefined || value === null || value === '') {
              missingFields.push(field.label || field.key);
            }
          }
        });

        if (missingFields.length > 0) {
          this.showToast(`[${senderInfo.displayName}] 请配置: ${missingFields.join(', ')}`, 'warning');
          return;
        }
      }
    }

    await this.saveSettings();

    // 立即更新 UI 状态，不等待响应
    this.settings.isRunning = true;
    this.updateUI();
    this.showToast('正在启动监控...', 'success');

    try {
      const response = await chrome.runtime.sendMessage({ action: 'startMonitor' });

      if (response && response.success) {
        this.addLog('success', '监控已启动');
      } else {
        this.settings.isRunning = false;
        this.updateUI();
        this.showToast('启动失败: ' + (response?.error || '未知错误'), 'error');
        this.addLog('error', '启动失败: ' + (response?.error || '未知错误'));
      }
    } catch (e) {
      this.settings.isRunning = false;
      this.updateUI();
      this.showToast('启动异常: ' + e.message, 'error');
      this.addLog('error', '启动异常: ' + e.message);
    }
  }

  async stopMonitor() {
    // 立即更新 UI 状态
    this.settings.isRunning = false;
    this.updateUI();
    this.showToast('监控已停止', 'success');
    this.addLog('info', '监控已停止');

    try {
      await chrome.runtime.sendMessage({ action: 'stopMonitor' });
    } catch (e) {
      this.showToast('停止失败: ' + e.message, 'error');
    }
  }

  async testNotification() {
    // 检查是否有启用的发送器
    const enabledSenders = this.settings.senders?.filter(s => s.enabled) || [];
    if (enabledSenders.length === 0) {
      this.showToast('请至少启用一个发送器', 'warning');
      return;
    }

    this.addLog('info', `正在向 ${enabledSenders.length} 个发送器发送测试通知...`);

    try {
      const response = await chrome.runtime.sendMessage({ action: 'testNotification' });

      if (response.success) {
        if (response.warning) {
          this.showToast(response.warning, 'warning');
        } else {
          this.showToast('测试通知已发送', 'success');
        }
        this.addLog('success', '测试通知发送成功');
      } else {
        this.showToast('发送失败: ' + response.error, 'error');
        this.addLog('error', '测试通知发送失败: ' + response.error);
      }
    } catch (e) {
      this.showToast('发送异常: ' + e.message, 'error');
      this.addLog('error', '测试通知发送异常: ' + e.message);
    }
  }

  async clearData() {
    if (!confirm('确定要清除所有数据吗？这将重置统计数据和缓存。')) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({ action: 'clearData' });
      this.stats = {
        checkCount: 0,
        newCount: 0,
        captchaCount: 0,
        startTime: null,
        lastCheck: null,
        nextCheckTime: null,
        scheduledInterval: null
      };
      this.updateStatsUI();
      this.showToast('数据已清除', 'success');
      this.addLog('warn', '所有数据已清除');
    } catch (e) {
      this.showToast('清除失败: ' + e.message, 'error');
    }
  }

  clearLogs() {
    // 清除 DOM 显示
    document.getElementById('logContainer').innerHTML = 
      '<div class="log-entry info"><span class="log-time">' + 
      this.formatTime() + '</span>日志已清除</div>';
    
    // 清除 storage 中的日志
    chrome.storage.local.set({ logs: [] });
  }

  async fetchTestItems() {
    const targetUrl = document.getElementById('targetUrl').value.trim();
    
    if (!targetUrl) {
      this.showToast('请先输入博主页面 URL', 'warning');
      return;
    }
    
    const btn = document.getElementById('fetchTestBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 抓取中...';
    
    this.addLog('info', '正在测试抓取爆料...');
    
    try {
      // 测试抓取默认不发送通知，只显示结果
      const response = await chrome.runtime.sendMessage({
        action: 'fetchTestItems',
        url: targetUrl,
        options: { sendNotification: false }
      });

      if (response.success) {
        const items = response.items || [];
        this.displayFetchResults(items);
        this.showToast(`抓取成功，共 ${items.length} 条爆料`, 'success');
        this.addLog('success', `测试抓取成功，获取 ${items.length} 条爆料`);
      } else {
        this.showToast('抓取失败: ' + response.error, 'error');
        this.addLog('error', '测试抓取失败: ' + response.error);
      }
    } catch (e) {
      this.showToast('抓取异常: ' + e.message, 'error');
      this.addLog('error', '测试抓取异常: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 测试抓取爆料';
    }
  }

  displayFetchResults(items) {
    const resultsDiv = document.getElementById('fetchResults');
    const listDiv = document.getElementById('fetchList');
    const countSpan = document.getElementById('fetchCount');

    const safeItems = items || [];
    countSpan.textContent = safeItems.length;

    if (safeItems.length === 0) {
      listDiv.innerHTML = '<div class="log-entry warn">未找到爆料内容</div>';
    } else {
      listDiv.innerHTML = safeItems.map((item, i) =>
        `<div class="log-entry info" style="padding: 8px 0; border-bottom: 1px solid #21262d">
          <div style="font-weight: 600; margin-bottom: 4px">${i + 1}. ${this.escapeHtml(item.title || '无标题')}</div>
          <div style="color: #d29922; font-size: 10px">💰 ${this.escapeHtml(item.price || '未知价格')}</div>
          <div style="color: #8b949e; font-size: 10px">⏰ ${this.escapeHtml(item.time || '未知时间')}</div>
        </div>`
      ).join('');
    }

    resultsDiv.style.display = 'block';
  }

  closeFetchResults() {
    document.getElementById('fetchResults').style.display = 'none';
  }

  updateUI() {
    const statusCard = document.getElementById('statusCard');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const statusDetail = document.getElementById('statusDetail');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const progressBar = document.getElementById('progressBar');

    // 检查验证码状态
    chrome.storage.local.get(['captchaDetected'], (data) => {
      if (data.captchaDetected) {
        statusCard.className = 'status-card captcha';
        statusIcon.textContent = '⚠️';
        statusText.textContent = '检测到验证码';
        statusDetail.textContent = '请打开监控标签页手动处理验证码';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        progressBar.style.display = 'none';
        return;
      }

      if (this.settings.isRunning) {
        statusCard.className = 'status-card running';
        statusIcon.textContent = '✅';
        statusText.textContent = '监控运行中';
        statusDetail.textContent = '正在监控: ' + this.truncateUrl(this.settings.targetUrl);
        startBtn.disabled = true;
        stopBtn.disabled = false;
        progressBar.style.display = 'block';
        this.startProgressUpdate();
      } else {
        statusCard.className = 'status-card stopped';
        statusIcon.textContent = '⏹️';
        statusText.textContent = '监控未启动';
        statusDetail.textContent = '配置好设置后点击开始监控';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        progressBar.style.display = 'none';
        this.stopProgressUpdate();
      }
    });
  }

  updateStatsUI() {
    document.getElementById('checkCount').textContent = this.stats.checkCount || 0;
    document.getElementById('newCount').textContent = this.stats.newCount || 0;
    document.getElementById('captchaCount').textContent = this.stats.captchaCount || 0;
    document.getElementById('lastCheck').value = this.stats.lastCheck 
      ? this.formatDateTime(this.stats.lastCheck) 
      : '-';
    document.getElementById('startTime').value = this.stats.startTime 
      ? this.formatDateTime(this.stats.startTime) 
      : '-';
    
    // 计算运行时长
    if (this.stats.startTime) {
      const hours = Math.floor((Date.now() - this.stats.startTime) / 3600000);
      document.getElementById('runTime').textContent = hours + 'h';
    } else {
      document.getElementById('runTime').textContent = '0h';
    }
  }

  startProgressUpdate() {
    this.stopProgressUpdate();

    // 直接从已加载的 stats 读取 nextCheckTime
    if (this.stats && this.stats.nextCheckTime) {
      this.nextCheckTime = this.stats.nextCheckTime;
    } else {
      // 如果没有，使用默认间隔
      this.nextCheckTime = Date.now() + ((this.settings.refreshInterval || 60) * 1000);
    }

    // 使用实际调度间隔（如果有的话），否则使用用户设置的间隔
    this.progressDuration = this.stats?.scheduledInterval || ((this.settings.refreshInterval || 60) * 1000);

    // 启动进度更新
    this.progressIntervalId = setInterval(() => {
      this.updateProgressBar();
    }, 1000);

    this.updateProgressBar();
  }

  updateProgressBar() {
    const fill = document.getElementById('progressFill');
    const statusDetail = document.getElementById('statusDetail');

    if (!this.nextCheckTime) {
      statusDetail.textContent = '等待检查...';
      return;
    }

    const now = Date.now();
    const remaining = Math.max(0, this.nextCheckTime - now);
    const progress = Math.min(100, Math.max(0, ((this.progressDuration - remaining) / this.progressDuration) * 100));

    fill.style.width = progress + '%';

    // 显示剩余时间
    const remainingSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    if (remainingSeconds > 0) {
      if (minutes > 0) {
        statusDetail.textContent = `下次检查: ${minutes}分${seconds}秒`;
      } else {
        statusDetail.textContent = `下次检查: ${seconds}秒`;
      }
    } else {
      // 倒计时结束，但不立即显示"正在检查"，等 5 秒后才显示
      statusDetail.textContent = '即将检查...';
    }
  }

  stopProgressUpdate() {
    if (this.progressIntervalId) {
      clearInterval(this.progressIntervalId);
      this.progressIntervalId = null;
    }
    this.nextCheckTime = null;
  }

  startPolling() {
    // 定期更新状态和统计
    this.updateInterval = setInterval(async () => {
      // 检查组件是否已销毁
      if (!this.updateInterval) return;

      await this.loadStats();

      // 检查运行状态
      const data = await chrome.storage.local.get(['settings', 'stats']);
      if (data.settings) {
        const wasRunning = this.settings.isRunning;
        this.settings = { ...this.settings, ...data.settings };

        if (wasRunning !== this.settings.isRunning) {
          this.updateUI();
        }

        // 更新 nextCheckTime
        if (this.settings.isRunning && data.stats && data.stats.nextCheckTime) {
          this.nextCheckTime = data.stats.nextCheckTime;
          this.progressDuration = data.stats.scheduledInterval || ((this.settings.refreshInterval || 60) * 1000);
        }
      }

      // 更新日志
      this.loadLogs();
    }, 1000);
  }

  stopPolling() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.stopProgressUpdate();
  }

  async loadLogs(initial = false) {
    try {
      const result = await chrome.storage.local.get(['logs']);
      const logs = result.logs || [];
      const container = document.getElementById('logContainer');
      
      if (initial) {
        // 初始化时加载所有日志
        container.innerHTML = '';
        if (logs.length === 0) {
          container.innerHTML = '<div class="log-entry info"><span class="log-time">' + 
            this.formatTime() + '</span>系统就绪</div>';
        } else {
          logs.forEach(log => {
            const entry = document.createElement('div');
            entry.className = `log-entry ${log.type}`;
            entry.innerHTML = `<span class="log-time">${log.time}</span>${log.message}`;
            container.appendChild(entry);
          });
          container.scrollTop = container.scrollHeight;
        }
      } else {
        // 只更新新日志
        const currentLogs = container.children.length;
        if (logs.length > currentLogs) {
          logs.slice(currentLogs).forEach(log => {
            const entry = document.createElement('div');
            entry.className = `log-entry ${log.type}`;
            entry.innerHTML = `<span class="log-time">${log.time}</span>${log.message}`;
            container.appendChild(entry);
          });
          container.scrollTop = container.scrollHeight;
        }
      }
    } catch (e) {
      // 忽略错误
    }
  }

  addLog(type, message) {
    const container = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${this.formatTime()}</span>${message}`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  formatTime(date = new Date()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  truncateUrl(url, maxLength = 35) {
    if (!url) return '';
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  }

  /**
   * 清理资源（页面卸载时调用）
   */
  destroy() {
    this.stopPolling();
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const controller = new PopupController();

  // 页面卸载时清理资源
  window.addEventListener('unload', () => {
    controller.destroy();
  });
});