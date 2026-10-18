/**
 * Tauri 桥接：pluginManager
 *
 * 结合前端 Web Worker 洛雪沙箱引擎，完全替代原有的 Node.js vm。
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/pluginManager/common/constant';
import { PluginWorkerHost } from '@infra/pluginManager/worker/pluginWorkerHost';
import { tauriInvoke } from '../ipc';

class TauriPluginManagerService {
    private plugins = new Map<string, PluginWorkerHost>();
    private changeListeners = new Set<(plugins: any[]) => void>();

    constructor() {
        this.loadInstalledPlugins();
    }

    private async loadInstalledPlugins(): Promise<void> {
        try {
            // 从持久化存储或本地目录读取插件代码
            const rawPlugins = await tauriInvoke<Array<{ hash: string; code: string }>>('plugin_load_all');
            if (Array.isArray(rawPlugins)) {
                for (const item of rawPlugins) {
                    await this.loadPluginCode(item.hash, item.code);
                }
            }
        } catch {
            // 无本地插件时不影响启动
        }
    }

    public async loadPluginCode(hash: string, code: string): Promise<PluginWorkerHost> {
        const host = new PluginWorkerHost(hash, code);
        await host.initialize(code);
        this.plugins.set(hash, host);
        this.notifyChange();
        return host;
    }

    private notifyChange(): void {
        const list = this.getAllPlugins();
        this.changeListeners.forEach((cb) => {
            try {
                cb(list);
            } catch (err) {
                console.error('[TauriPluginManager] Listener error:', err);
            }
        });
    }

    public getAllPlugins(): any[] {
        return Array.from(this.plugins.values()).map((p) => ({
            hash: p.hash,
            name: p.name,
            version: p.version,
            author: p.author,
            description: p.description,
            supportedSources: p.supportedSources,
            platform: p.supportedSources[0] || 'custom',
        }));
    }

    public async getMediaSource(params: any): Promise<any> {
        const { hash, musicItem, quality } = params;
        const plugin = this.plugins.get(hash) || Array.from(this.plugins.values())[0];
        if (!plugin) {
            return null;
        }

        try {
            const url = await plugin.invokeAction({
                source: musicItem.platform || musicItem.source || 'kw',
                action: 'musicUrl',
                info: {
                    type: quality || '128k',
                    musicInfo: {
                        songmid: musicItem.id || musicItem.songmid,
                        hash: musicItem.hash,
                        name: musicItem.title || musicItem.name,
                        singer: musicItem.artist || musicItem.singer,
                    },
                },
            });

            if (url && typeof url === 'string') {
                return {
                    url,
                    quality: quality || '128k',
                };
            }
        } catch (err) {
            console.warn('[TauriPluginManager] getMediaSource failed:', err);
        }
        return null;
    }

    public async getLyric(musicItem: any): Promise<any> {
        for (const plugin of this.plugins.values()) {
            try {
                const lyricResult = await plugin.invokeAction({
                    source: musicItem.platform || musicItem.source,
                    action: 'lyric',
                    info: {
                        musicInfo: {
                            songmid: musicItem.id || musicItem.songmid,
                            name: musicItem.title || musicItem.name,
                            singer: musicItem.artist || musicItem.singer,
                        },
                    },
                });
                if (lyricResult) {
                    return lyricResult;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    public addChangeListener(cb: (plugins: any[]) => void): () => void {
        this.changeListeners.add(cb);
        return () => this.changeListeners.delete(cb);
    }
}

const service = new TauriPluginManagerService();

export function registerTauriPluginManagerBridge(): void {
    const mod = {
        callPluginMethod: async (_params: any): Promise<any> => null,
        installPlugin: async (urlOrPath: string): Promise<{ success: boolean; message?: string }> => {
            try {
                let code = '';
                if (urlOrPath.startsWith('http')) {
                    const res = await fetch(urlOrPath);
                    code = await res.text();
                } else {
                    code = await tauriInvoke<string>('fs_read_file', { path: urlOrPath, encoding: 'utf-8' });
                }
                const hash = Math.random().toString(36).slice(2);
                await service.loadPluginCode(hash, code);
                await tauriInvoke('plugin_save', { hash, code }).catch(() => {});
                return { success: true };
            } catch (err: any) {
                return { success: false, message: err.message };
            }
        },
        uninstallPlugin: async (hash: string): Promise<{ success: boolean; message?: string }> => {
            await tauriInvoke('plugin_delete', { hash }).catch(() => {});
            return { success: true };
        },
        updatePlugin: async (_hash: string): Promise<{ success: boolean; message?: string }> => ({ success: true }),
        updateAllPlugins: async (): Promise<{ updated: number; failed: number }> => ({ updated: 0, failed: 0 }),
        getAllPlugins: async (): Promise<any[]> => service.getAllPlugins(),
        setPluginMeta: async (): Promise<void> => {},
        batchSetPluginMeta: async (): Promise<void> => {},
        getAllPluginMeta: async (): Promise<any> => ({}),
        getCachedPlugins: (): any[] => service.getAllPlugins(),
        getLyric: (musicItem: any): Promise<any> => service.getLyric(musicItem),
        getMediaSource: (params: any): Promise<any> => service.getMediaSource(params),
        onPluginListChanged: (cb: (plugins: any[]) => void): (() => void) => service.addChangeListener(cb),
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = mod;
}
