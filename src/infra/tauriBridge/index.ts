/**
 * Tauri ContextBridge 统一适配层入口
 */
import { isTauriEnvironment } from './isTauri';
import { injectBridgesSync } from './autoInject';

export async function initTauriBridges(): Promise<boolean> {
    if (!isTauriEnvironment()) {
        return false;
    }

    injectBridgesSync();
    console.log('[TauriBridge] All Tauri bridges confirmed ready.');
    return true;
}

export { isTauriEnvironment, injectBridgesSync };
