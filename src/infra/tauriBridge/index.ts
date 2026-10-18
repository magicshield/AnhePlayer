/**
 * Tauri ContextBridge 统一适配层入口
 *
 * 在应用启动前检测运行环境：
 * 若在 Tauri 宿主环境下，则将基于 Tauri IPC 的 Bridge 注入至全局 window[CONTEXT_BRIDGE_KEY]，
 * 使得上层所有 React 业务代码、Hooks 和 Jotai 原子状态完全零感知，无缝兼容两套桌面引擎。
 */
import { isTauriEnvironment } from './isTauri';
import { registerAppConfigBridge } from './bridges/appConfig';
import { registerGlobalContextBridge } from './bridges/globalContext';
import { registerSystemUtilBridge } from './bridges/systemUtil';
import { registerFsUtilBridge } from './bridges/fsUtil';
import { registerCommonBridges } from './bridges/commonBridges';
import { registerDataBridges } from './bridges/dataBridges';
import { registerTauriPluginManagerBridge } from './bridges/pluginManagerBridge';

export async function initTauriBridges(): Promise<boolean> {
    if (!isTauriEnvironment()) {
        return false;
    }

    console.log('[TauriBridge] Detected Tauri environment. Initializing IPC bridges...');

    await registerGlobalContextBridge();
    registerAppConfigBridge();
    registerSystemUtilBridge();
    registerFsUtilBridge();
    registerCommonBridges();
    registerDataBridges();
    registerTauriPluginManagerBridge();

    console.log('[TauriBridge] All Tauri bridges initialized successfully.');
    return true;
}

export { isTauriEnvironment };
