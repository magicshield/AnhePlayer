/**
 * Tauri 桥接：基础通用模块
 * （logger / i18n / requestForwarder / appSync）
 *
 * 注：themepack 已拆分至独立模块 themepackBridge.ts
 */
import { CONTEXT_BRIDGE_KEY as LOGGER_KEY } from '@infra/logger/common/constant';
import { CONTEXT_BRIDGE_KEY as I18N_KEY } from '@infra/i18n/common/constant';
import { CONTEXT_BRIDGE_KEY as FORWARDER_KEY } from '@infra/requestForwarder/common/constant';
import {
    CONTEXT_BRIDGE_KEY as APP_SYNC_KEY,
    CONTEXT_BRIDGE_KEY_AUXILIARY,
} from '@infra/appSync/common/constant';
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

    // 3. Request Forwarder (Tauri 架构下请求直接走 Tauri HTTP 或直接网络请求)
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

    // 4. AppSync（主窗口与辅助窗口同步桥接）
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

    // 5. AppSync Auxiliary（辅助窗口专属）
    //    主窗口经 tauri-app-state-sync 全量广播状态，辅助窗在本地合并出快照，
    //    向 renderer 暴露 getAppState / onStateChange（远端重构后的契约）。
    let auxState: Record<string, unknown> = {};
    const auxListeners = new Set<(state: any, changed: any) => void>();
    tauriListen<Record<string, unknown>>('tauri-app-state-sync', (patch) => {
        if (!patch || typeof patch !== 'object') {
            return;
        }
        auxState = { ...auxState, ...patch };
        auxListeners.forEach((cb) => {
            try {
                cb(auxState, patch);
            } catch {
                /* 单个订阅者异常不影响其他 */
            }
        });
    }).catch(() => {});

    (window as any)[CONTEXT_BRIDGE_KEY_AUXILIARY] = {
        getAppState: () => auxState,
        onStateChange: (cb: (state: any, changed: any) => void) => {
            auxListeners.add(cb);
            return () => {
                auxListeners.delete(cb);
            };
        },
        // 主窗口全量广播，无需按 key 定向订阅
        subscribeAppState: (_keys: string[]) => {},
        sendCommand: (command: string, data?: unknown) => {
            tauriEmit('tauri-command', { command, data }).catch(() => {});
        },
    };
}
