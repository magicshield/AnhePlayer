/**
 * Tauri 桥接：globalContext
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/globalContext/common/constant';
import { tauriInvoke } from '../ipc';

const defaultContext = {
    appVersion: '1.0.19',
    appPath: {
        defaultDownloadPath: 'C:\\Users\\Administrator\\Downloads',
        temp: 'C:\\Users\\Administrator\\AppData\\Local\\Temp',
        userData: 'C:\\Users\\Administrator\\AppData\\Roaming\\AnhePlayer',
        res: '',
    },
    platform: 'win32',
    isWin10OrAbove: true,
};

// 同步初始化默认上下文，确保任何模块在加载求值时都能安全访问
if (typeof window !== 'undefined') {
    (window as any)[CONTEXT_BRIDGE_KEY] = { ...defaultContext };
    (globalThis as any).globalContext = (window as any)[CONTEXT_BRIDGE_KEY];
}

export function registerGlobalContextBridge(): void {
    if (typeof window !== 'undefined') {
        (window as any)[CONTEXT_BRIDGE_KEY] = { ...defaultContext };
        (globalThis as any).globalContext = (window as any)[CONTEXT_BRIDGE_KEY];
    }

    // 异步更新远程 Rust 计算的动态系统真实路径
    tauriInvoke('global_context_get')
        .then((remoteContext) => {
            if (remoteContext && typeof remoteContext === 'object') {
                Object.assign((window as any)[CONTEXT_BRIDGE_KEY], remoteContext);
                (globalThis as any).globalContext = (window as any)[CONTEXT_BRIDGE_KEY];
            }
        })
        .catch(() => {});
}
