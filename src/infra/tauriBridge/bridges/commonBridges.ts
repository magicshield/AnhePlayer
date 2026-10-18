/**
 * Tauri 桥接：基础通用模块（logger / i18n / shortCut / requestForwarder / themepack）
 */
import { CONTEXT_BRIDGE_KEY as LOGGER_KEY } from '@infra/logger/common/constant';
import { CONTEXT_BRIDGE_KEY as I18N_KEY } from '@infra/i18n/common/constant';
import { CONTEXT_BRIDGE_KEY as SHORTCUT_KEY } from '@infra/shortCut/common/constant';
import { CONTEXT_BRIDGE_KEY as FORWARDER_KEY } from '@infra/requestForwarder/common/constant';
import { CONTEXT_BRIDGE_KEY as THEME_KEY } from '@infra/themepack/common/constant';
import { tauriInvoke, tauriListen } from '../ipc';

export function registerCommonBridges(): void {
    // 1. Logger
    (window as any)[LOGGER_KEY] = {
        log: (entry: any) => {
            console.log(`[TauriLog] [${entry?.level || 'info'}]`, entry);
            tauriInvoke('log_entry', { entry }).catch(() => {});
        },
    };

    // 2. i18n
    (window as any)[I18N_KEY] = {
        setupLanguage: async () => {
            try {
                return await tauriInvoke('i18n_setup');
            } catch {
                return { currentLang: 'zh-CN', allLangs: ['zh-CN', 'en-US'], content: {} };
            }
        },
        changeLanguage: async (lang: string) => {
            try {
                return await tauriInvoke('i18n_change_lang', { lang });
            } catch {
                return {};
            }
        },
    };

    // 3. ShortCut
    (window as any)[SHORTCUT_KEY] = {
        getGlobalShortCutStatus: async () => {
            try {
                return await tauriInvoke('shortcut_get_status');
            } catch {
                return [];
            }
        },
        onGlobalShortCutStatusChanged: (callback: (status: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('shortcut-status-changed', (data) => {
                callback(data);
            }).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 4. Request Forwarder (Tauri 环境下可直接通过 Rust 转发或返回本地反向代理端口)
    (window as any)[FORWARDER_KEY] = {
        getPort: async () => {
            try {
                return await tauriInvoke<number | null>('forwarder_get_port');
            } catch {
                return null;
            }
        },
        onPortChanged: (callback: (port: number | null) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen<number | null>('forwarder-port-changed', (p) => {
                callback(p);
            }).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 5. ThemePack
    (window as any)[THEME_KEY] = {
        getCurrentTheme: async () => {
            try {
                return await tauriInvoke('theme_get_current');
            } catch {
                return null;
            }
        },
        setTheme: (theme: any) => {
            tauriInvoke('theme_set', { theme }).catch(console.error);
        },
        getAllThemes: async () => {
            try {
                return await tauriInvoke('theme_get_all');
            } catch {
                return [];
            }
        },
        onThemeChanged: (callback: (theme: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('theme-changed', (t) => {
                callback(t);
            }).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };
}
