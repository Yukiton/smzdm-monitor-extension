/**
 * 发送器注册表
 * 管理所有可用的发送器类型
 */

// 发送器注册表
const senderRegistry = new Map();

/**
 * 注册发送器
 * @param {typeof BaseSender} SenderClass - 发送器类
 */
function registerSender(SenderClass) {
  if (!SenderClass || !SenderClass.name) {
    throw new Error('Invalid sender class');
  }
  senderRegistry.set(SenderClass.name, SenderClass);
}

/**
 * 获取发送器类
 * @param {string} name - 发送器名称
 * @returns {typeof BaseSender|undefined}
 */
function getSenderClass(name) {
  return senderRegistry.get(name);
}

/**
 * 获取所有已注册的发送器
 * @returns {Array<{name: string, displayName: string, icon: string, description: string, configFields: Array}>}
 */
function getAllSenders() {
  return Array.from(senderRegistry.values()).map(SenderClass => ({
    name: SenderClass.name,
    displayName: SenderClass.displayName,
    icon: SenderClass.icon,
    description: SenderClass.description,
    configFields: SenderClass.configFields
  }));
}

/**
 * 创建发送器实例
 * @param {string} name - 发送器名称
 * @param {Object} config - 发送器配置
 * @returns {BaseSender|null}
 */
function createSender(name, config = {}) {
  const SenderClass = senderRegistry.get(name);
  if (!SenderClass) {
    return null;
  }
  return new SenderClass(config);
}

/**
 * 检查发送器是否已注册
 * @param {string} name - 发送器名称
 * @returns {boolean}
 */
function hasSender(name) {
  return senderRegistry.has(name);
}

// 注册内置发送器
// 注意：在 Service Worker 中，我们需要导入发送器类
// 由于 manifest v3 不支持 ES modules 的 import，我们将使用 importScripts

// 导出函数
if (typeof self !== 'undefined') {
  self.senderRegistry = senderRegistry;
  self.registerSender = registerSender;
  self.getSenderClass = getSenderClass;
  self.getAllSenders = getAllSenders;
  self.createSender = createSender;
  self.hasSender = hasSender;
}