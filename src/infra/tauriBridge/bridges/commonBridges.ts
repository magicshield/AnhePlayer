/**
 * Tauri 桥接：基础通用模块
 * （logger / i18n / shortCut / requestForwarder / appSync / windowDrag）
 *
 * 注：themepack 已拆分至独立模块 themepackBridge.ts
 */
import { CONTEXT_BRIDGE_KEY as LOGGER_KEY } from '@infra/logger/common/constant';
import { CONTEXT_BRIDGE_KEY as I18N_KEY } from '@infra/i18n/common/constant';
import { CONTEXT_BRIDGE_KEY as SHORTCUT_KEY } from '@infra/shortCut/common/constant';
import { CONTEXT_BRIDGE_KEY as FORWARDER_KEY } from '@infra/requestForwarder/common/constant';
import { CONTEXT_BRIDGE_KEY as APP_SYNC_KEY, CONTEXT_BRIDGE_KEY_AUXILIARY } from '@infra/appSync/common/constant';
import { CONTEXT_BRIDGE_KEY as WINDOW_DRAG_KEY } from '@infra/windowDrag/common/constant';
import zhCN from '../../../../res/lang/zh-CN.json';
import { tauriInvoke, tauriListen, tauriEmit } from '../ipc';
import EventEmitter from 'eventemitter3';

const internalSyncEe = new EventEmitter();

export function registerCommonBridges(): void {
    // 1. Logger
    (window as any)[LOGGER_KEY] = {
        log: (entry: any) => {
            console.log(`[TauriLog] [${entry?.level || 'info'}]`, entry);
            tauriInvoke('log_entry', { entry }).catch(() => {});
        },
    };

    // 2. i18n（使用打包内置 zh-CN，秒级返回，确保 i18nInstance 正常启动）
    (window as any)[I18N_KEY] = {
        setupLanguage: async () => {
            return {
                lang: 'zh-CN',
                content: zhCN,
                allLangs: ['zh-CN'],
            };
        },
        changeLanguage: async (lang: string) => {
            return {
                lang,
                content: zhCN,
            };
        },
    };

    // 3. ShortCut（Tauri 版暂不支持全局快捷键，返回空列表保持接口兼容）
    (window as any)[SHORTCUT_KEY] = {
        getGlobalShortCutStatus: async (): Promise<any[]> => [],
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

    // 4. Request Forwarder (Tauri 架构下请求直接走 Tauri HTTP 或直接网络请求)
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

    // 5. AppSync（主窗口与辅助窗口同步桥接）
    (window as any)[APP_SYNC_KEY] = {
        syncAppState: (state: any) => {
            tauriEmit('tauri-app-state-sync', state).catch(() => {});
        },
        syncAppStateTo: (_windowType: string, state: any) => {
            tauriEmit('tauri-app-state-sync', state).catch(() => {});
        },
        onCommand: (command: string, cb: (data: unknown, from: string) => void) => {
            const handler = (payload: { command: string; data: unknown }, from: string) => {
                if (payload.command === command) {
                    cb(payload.data, from);
                }
            };
            internalSyncEe.on('command', handler);

            let unlistenFn: (() => void) | null = null;
            tauriListen<{ command: string; data: unknown }>('tauri-command', (payload) => {
                if (payload && payload.command === command) {
                    cb(payload.data, 'tauri');
                }
            }).then((u) => {
                unlistenFn = u;
            });

            return () => {
                internalSyncEe.off('command', handler);
                if (unlistenFn) unlistenFn();
            };
        },
        sendCommand: (command: string, data?: unknown) => {
            internalSyncEe.emit('command', { command, data }, 'main');
            tauriEmit('tauri-command', { command, data }).catch(() => {});
        },
        onSubscribe: (_cb: (windowType: string) => void) => {
            return () => {};
        },
    };

    // 7. AppSync Auxiliary（辅助窗口专属）
    (window as any)[CONTEXT_BRIDGE_KEY_AUXILIARY] = {
        subscribe: (_keys: string[], _onStateChange: (state: any) => void) => {
            return () => {};
        },
        sendCommand: (command: string, data?: unknown) => {
            tauriEmit('tauri-command', { command, data }).catch(() => {});
        },
        onCommand: (command: string, cb: (data: unknown, from: string) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen<{ command: string; data: unknown }>('tauri-command', (payload) => {
                if (payload && payload.command === command) {
                    cb(payload.data, 'tauri');
                }
            }).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 8. WindowDrag（窗口拖拽）
    (window as any)[WINDOW_DRAG_KEY] = {
        startDrag: (_offset: any) => {},
        stopDrag: () => {},
    };
}
