/**
 * Tauri ContextBridge 同步自执行注册层
 *
 * 在任何模块被 static import 或执行前同步挂载至全局 window[CONTEXT_BRIDGE_KEY]，
 * 彻底解决 ES Module 顶层求值 (top-level evaluation) 时访问 undefined 导致的致命崩溃和白屏问题。
 */
import { isTauriEnvironment } from './isTauri';
import { registerGlobalContextBridge } from './bridges/globalContext';
import { registerAppConfigBridge } from './bridges/appConfig';
import { registerSystemUtilBridge } from './bridges/systemUtil';
import { registerFsUtilBridge } from './bridges/fsUtil';
import { registerCommonBridges } from './bridges/commonBridges';
import { registerDataBridges } from './bridges/dataBridges';
import { registerTauriPluginManagerBridge } from './bridges/pluginManagerBridge';

export function injectBridgesSync(): void {
    if (!isTauriEnvironment()) {
        return;
    }

    try {
        registerGlobalContextBridge();
        registerAppConfigBridge();
        registerSystemUtilBridge();
        registerFsUtilBridge();
        registerCommonBridges();
        registerDataBridges();
        registerTauriPluginManagerBridge();
        console.log('[TauriBridge] Synchronously auto-injected all context bridges.');
    } catch (err) {
        console.error('[TauriBridge] Failed to synchronously inject bridges:', err);
    }
}

// 模块加载时立即同步执行
injectBridgesSync();
