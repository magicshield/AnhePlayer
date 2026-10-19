/**
 * Tauri 桥接：appConfig
 */
import type { IAppConfig } from '@appTypes/infra/appConfig';
import { CONTEXT_BRIDGE_KEY } from '@infra/appConfig/common/constant';
import defaultAppConfig from '@infra/appConfig/common/defaultAppConfig';
import { tauriInvoke, tauriListen } from '../ipc';

export function registerAppConfigBridge(): void {
    const listeners = new Set<(patch: IAppConfig, source: string) => void>();

    tauriListen<{ patch: IAppConfig; source: string }>('app-config-update', (payload) => {
        if (payload?.patch) {
            listeners.forEach((callback) => {
                try {
                    callback(payload.patch, payload.source || 'tauri');
                } catch (e) {
                    console.error('[appConfig] listener error:', e);
                }
            });
        }
    }).catch(console.error);

    const bridge = {
        syncConfig: async (): Promise<IAppConfig> => {
            try {
                const config = await tauriInvoke<IAppConfig>('app_config_sync');
                return { ...defaultAppConfig, ...(config || {}) };
            } catch {
                return { ...defaultAppConfig };
            }
        },

        setConfig: (config: IAppConfig): void => {
            // 本地立即派发，确保当前窗口 UI 零延迟响应（乐观更新）
            listeners.forEach((callback) => {
                try {
                    callback(config, 'renderer');
                } catch (e) {
                    console.error('[appConfig] local dispatch error:', e);
                }
            });
            tauriInvoke('app_config_set', { config }).catch(console.error);
        },

        reset: (): void => {
            listeners.forEach((callback) => {
                try {
                    callback({ ...defaultAppConfig }, 'renderer');
                } catch (e) {
                    console.error('[appConfig] reset dispatch error:', e);
                }
            });
            tauriInvoke('app_config_reset').catch(console.error);
        },

        onConfigUpdate: (callback: (patch: IAppConfig, source: string) => void): (() => void) => {
            listeners.add(callback);
            return () => {
                listeners.delete(callback);
            };
        },
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = bridge;
}
