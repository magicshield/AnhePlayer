/**
 * Tauri 桥接：globalContext
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/globalContext/common/constant';
import { tauriInvoke } from '../ipc';

export async function registerGlobalContextBridge(): Promise<void> {
    const defaultContext = {
        appVersion: '1.0.16',
        appPath: {
            defaultDownloadPath: 'C:\\Users\\Administrator\\Downloads',
            temp: 'C:\\Users\\Administrator\\AppData\\Local\\Temp',
            userData: 'C:\\Users\\Administrator\\AppData\\Roaming\\AnhePlayer',
            res: '',
        },
        platform: 'win32',
        isWin10OrAbove: true,
    };

    try {
        const remoteContext = await tauriInvoke('global_context_get');
        const context = remoteContext || defaultContext;
        (window as any)[CONTEXT_BRIDGE_KEY] = context;
        (globalThis as any).globalContext = context;
    } catch {
        (window as any)[CONTEXT_BRIDGE_KEY] = defaultContext;
        (globalThis as any).globalContext = defaultContext;
    }
}
