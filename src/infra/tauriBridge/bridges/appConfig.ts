/**
 * Tauri 桥接：appConfig
 */
import type { IAppConfig } from '@appTypes/infra/appConfig';
import { CONTEXT_BRIDGE_KEY } from '@infra/appConfig/common/constant';
import defaultAppConfig from '@infra/appConfig/common/defaultAppConfig';
import { tauriInvoke, tauriListen } from '../ipc';

export function registerAppConfigBridge(): void {
    const bridge = {
        syncConfig: async (): Promise<IAppConfig> => {
            try {
                const config = await tauriInvoke<IAppConfig>('app_config_sync');
                return config || defaultAppConfig;
            } catch {
                return defaultAppConfig;
            }
        },

        setConfig: (config: IAppConfig): void => {
            tauriInvoke('app_config_set', { config }).catch(console.error);
        },

        reset: (): void => {
            tauriInvoke('app_config_reset').catch(console.error);
        },

        onConfigUpdate: (callback: (patch: IAppConfig, source: string) => void): (() => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen<{ patch: IAppConfig; source: string }>('app-config-update', (payload) => {
                if (payload) {
                    callback(payload.patch, payload.source || 'tauri');
                }
            }).then((unlisten) => {
                unlistenFn = unlisten;
            });

            return () => {
                if (unlistenFn) {
                    unlistenFn();
                }
            };
        },
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = bridge;
}
