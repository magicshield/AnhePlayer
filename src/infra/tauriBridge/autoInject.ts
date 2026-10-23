/**
 * Tauri bridge 同步注册层
 *
 * 在应用入口加载时同步挂载至全局 window[CONTEXT_BRIDGE_KEY]，
 * 彻底解决 ES Module 顶层求值 (top-level evaluation) 时访问 undefined 导致的致命崩溃和白屏问题。
 */
import { registerGlobalContextBridge } from './bridges/globalContext';
import { registerAppConfigBridge } from './bridges/appConfig';
import { registerSystemUtilBridge } from './bridges/systemUtil';
import { registerFsUtilBridge } from './bridges/fsUtil';
import { registerCommonBridges } from './bridges/commonBridges';
import { registerThemePackBridge } from './bridges/themepackBridge';
import { registerDataBridges } from './bridges/dataBridges';
import { registerTauriPluginManagerBridge } from './bridges/pluginManagerBridge';
import { registerNeteaseAccountBridge } from './bridges/neteaseAccountBridge';
import { hostPlatform } from './hostPlatform';

export function injectBridgesSync(): void {
    // 供样式层做宿主降级（WKWebView 大半径模糊开销远高于 Chromium）
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.host = hostPlatform();
    }

    try {
        registerGlobalContextBridge();
        registerAppConfigBridge();
        registerSystemUtilBridge();
        registerFsUtilBridge();
        registerCommonBridges();
        registerThemePackBridge();
        registerDataBridges();
        registerTauriPluginManagerBridge();
        registerNeteaseAccountBridge();
        console.log('[TauriBridge] Synchronously auto-injected all context bridges.');
    } catch (err) {
        console.error('[TauriBridge] Failed to synchronously inject bridges:', err);
    }
}

// 模块加载时立即同步执行
injectBridgesSync();
