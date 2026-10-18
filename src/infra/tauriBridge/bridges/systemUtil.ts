/**
 * Tauri 桥接：systemUtil
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/systemUtil/common/constant';
import { tauriInvoke } from '../ipc';

export function registerSystemUtilBridge(): void {
    const mod = {
        app: {
            exitApp: () => {
                tauriInvoke('exit_app').catch(console.error);
            },
            getCacheSize: async (): Promise<number> => {
                try {
                    return await tauriInvoke<number>('get_cache_size');
                } catch {
                    return 0;
                }
            },
            clearCache: () => {
                tauriInvoke('clear_cache').catch(console.error);
            },
            checkUpdate: async (): Promise<unknown> => {
                try {
                    return await tauriInvoke('check_update');
                } catch {
                    return null;
                }
            },
        },
        window: {
            minimizeWindow: (skipTaskBar?: boolean) => {
                tauriInvoke('minimize_window', { skipTaskBar }).catch(console.error);
            },
            showMainWindow: () => {
                tauriInvoke('show_main_window').catch(console.error);
            },
            toggleMaximize: () => {
                tauriInvoke('toggle_maximize').catch(console.error);
            },
            toggleVisible: () => {
                tauriInvoke('toggle_visible').catch(console.error);
            },
            ignoreMouseEvent: (ignore: boolean) => {
                tauriInvoke('ignore_mouse_event', { ignore }).catch(console.error);
            },
            enterMinimode: () => {
                tauriInvoke('enter_minimode').catch(console.error);
            },
            exitMinimode: () => {
                tauriInvoke('exit_minimode').catch(console.error);
            },
            toggleMinimode: () => {
                tauriInvoke('toggle_minimode').catch(console.error);
            },
        },
        shell: {
            openExternal: (url: string) => {
                tauriInvoke('open_external', { url }).catch(console.error);
            },
            openPath: (path: string) => {
                tauriInvoke('open_path', { path }).catch(console.error);
            },
            showItemInFolder: async (path: string): Promise<boolean> => {
                try {
                    return await tauriInvoke<boolean>('show_item_in_folder', { path });
                } catch {
                    return false;
                }
            },
        },
        dialog: {
            showOpenDialog: async (options: any): Promise<any> => {
                try {
                    const result = await tauriInvoke<string[] | string | null>('show_open_dialog', { options });
                    if (!result) return { canceled: true, filePaths: [] };
                    return {
                        canceled: false,
                        filePaths: Array.isArray(result) ? result : [result],
                    };
                } catch {
                    return { canceled: true, filePaths: [] };
                }
            },
            showSaveDialog: async (options: any): Promise<any> => {
                try {
                    const filePath = await tauriInvoke<string | null>('show_save_dialog', { options });
                    if (!filePath) return { canceled: true, filePath: undefined };
                    return { canceled: false, filePath };
                } catch {
                    return { canceled: true, filePath: undefined };
                }
            },
        },
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = mod;
}
