// SMZDM 爆料监控器 - Popup 控制脚本
// 版本 1.20.0 - 最终优化版本

class PopupController {
  constructor() {
    this.version = '1.22.1';
    this.settings = {};
    this.stats = {};
    this.updateInterval = null;
    this.progressInterval = null;
    this.nextCheckTime = null;
    
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadStats();
    await this.loadLogs(true); // 初始化时加载日志
    this.bindEvents();
    this.updateUI();
    this.startPolling();
    this.addLog('info', `插件已加载 (v${this.version})`);
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      this.settings = result.settings || {
        targetUrl: '',
        webhookUrl: '',
        refreshInterval: 60,
        antiCrawlerStrategy: 'random',
        captchaSensitivity: 'medium',
        maxRetries: 5,
        notifyFormat: 'markdown',
        isRunning: false
      };
      
      // 填充表单
      document.getElementById('targetUrl').value = this.settings.targetUrl || '';
      document.getElementById('webhookUrl').value = this.settings.webhookUrl || '';
      document.getElementById('refreshInterval').value = this.settings.refreshInterval || 60;
      document.getElementById('antiCrawlerStrategy').value = this.settings.antiCrawlerStrategy || 'random';
      document.getElementById('captchaSensitivity').value = this.settings.captchaSensitivity || 'medium';
      document.getElementById('maxRetries').value = this.settings.maxRetries || 5;
      document.getElementById('notifyFormat').value = this.settings.notifyFormat || 'markdown';
      
    } catch (e) {
      this.addLog('error', '加载设置失败: ' + e.message);
    }
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
        nextCheckTime: null
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
    document.getElementById('testBtn').addEventListener('click', () => this.testNotification());
    document.getElementById('clearDataBtn').addEventListener('click', () => this.clearData());
    document.getElementById('clearLogsBtn').addEventListener('click', () => this.clearLogs());
    
    // 测试抓取按钮
    document.getElementById('fetchTestBtn').addEventListener('click', () => this.fetchTestItems());
    document.getElementById('closeResultsBtn').addEventListener('click', () => this.closeFetchResults());

    // 设置变更自动保存
    const inputs = document.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.addEventListener('change', () => this.saveSettings());
      input.addEventListener('blur', () => this.saveSettings());
    });
    
    // 回车键保存
    inputs.forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.saveSettings();
        }
      });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
  }

  async saveSettings() {
    this.settings = {
      targetUrl: document.getElementById('targetUrl').value.trim(),
      webhookUrl: document.getElementById('webhookUrl').value.trim(),
      refreshInterval: parseInt(document.getElementById('refreshInterval').value) || 60,
      antiCrawlerStrategy: document.getElementById('antiCrawlerStrategy').value,
      captchaSensitivity: document.getElementById('captchaSensitivity').value,
      maxRetries: parseInt(document.getElementById('maxRetries').value) || 5,
      notifyFormat: document.getElementById('notifyFormat').value,
      isRunning: this.settings.isRunning
    };

    try {
      await chrome.storage.local.set({ settings: this.settings });
      this.addLog('info', '设置已保存');
      
      // 如果正在运行，更新后台设置
      if (this.settings.isRunning) {
        await chrome.runtime.sendMessage({ action: 'updateSettings', settings: this.settings });
      }
    } catch (e) {
      this.addLog('error', '保存设置失败: ' + e.message);
    }
  }

  async startMonitor() {
    const targetUrl = document.getElementById('targetUrl').value.trim();
    const webhookUrl = document.getElementById('webhookUrl').value.trim();

    if (!targetUrl) {
      this.showToast('请输入博主页面 URL', 'warning');
      return;
    }

    if (!webhookUrl) {
      this.showToast('请输入企微机器人 Webhook 地址', 'warning');
      return;
    }

    if (!webhookUrl.includes('qyapi.weixin.qq.com')) {
      this.showToast('Webhook 地址格式不正确', 'warning');
      return;
    }

    await this.saveSettings();

    try {
      const response = await chrome.runtime.sendMessage({ action: 'startMonitor' });
      
      if (response.success) {
        this.settings.isRunning = true;
        this.showToast('监控已启动', 'success');
        this.addLog('success', '监控已启动');
        this.updateUI();
      } else {
        this.showToast('启动失败: ' + response.error, 'error');
        this.addLog('error', '启动失败: ' + response.error);
      }
    } catch (e) {
      this.showToast('启动异常: ' + e.message, 'error');
      this.addLog('error', '启动异常: ' + e.message);
    }
  }

  async stopMonitor() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'stopMonitor' });
      
      if (response.success) {
        this.settings.isRunning = false;
        this.showToast('监控已停止', 'success');
        this.addLog('info', '监控已停止');
        this.updateUI();
      }
    } catch (e) {
      this.showToast('停止失败: ' + e.message, 'error');
    }
  }

  async testNotification() {
    const webhookUrl = document.getElementById('webhookUrl').value.trim();
    
    if (!webhookUrl) {
      this.showToast('请先输入 Webhook 地址', 'warning');
      return;
    }

    this.addLog('info', '正在发送测试通知...');
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'testNotification' });
      
      if (response.success) {
        this.showToast('测试通知已发送，请检查企微群', 'success');
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
        nextCheckTime: null
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
      const response = await chrome.runtime.sendMessage({ action: 'fetchTestItems', url: targetUrl });
      
      if (response.success) {
        this.displayFetchResults(response.items);
        this.showToast(`抓取成功，共 ${response.items.length} 条爆料`, 'success');
        this.addLog('success', `测试抓取成功，获取 ${response.items.length} 条爆料`);
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
    const listDiv = document.getElementById('fetchCount');
    const countSpan = document.getElementById('fetchCount');
    
    countSpan.textContent = items.length;
    
    if (items.length === 0) {
      listDiv.innerHTML = '<div class="log-entry warn">未找到爆料内容</div>';
    } else {
      listDiv.innerHTML = items.map((item, i) => 
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

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    
    this.progressInterval = (this.settings.refreshInterval || 60) * 1000;
    
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
    const progress = Math.min(100, Math.max(0, ((this.progressInterval - remaining) / this.progressInterval) * 100));
    
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
          this.progressInterval = (this.settings.refreshInterval || 60) * 1000;
        }
      }
      
      // 更新日志
      this.loadLogs();
    }, 1000);
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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});