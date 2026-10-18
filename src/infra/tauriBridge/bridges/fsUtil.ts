/**
 * Tauri 桥接：fsUtil
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/fsUtil/common/constant';
import { tauriInvoke } from '../ipc';

export function registerFsUtilBridge(): void {
    const mod = {
        writeFile: async (
            path: string,
            data: string | Uint8Array,
            _options?: { encoding?: string; flag?: string }
        ): Promise<void> => {
            const content = typeof data === 'string' ? data : Array.from(data);
            await tauriInvoke('fs_write_file', { path, content, isBinary: typeof data !== 'string' });
        },

        readFile: async (path: string, encoding?: string): Promise<string | Uint8Array> => {
            const res = await tauriInvoke<string | number[]>('fs_read_file', { path, encoding });
            if (typeof res === 'string') {
                return res;
            }
            return new Uint8Array(res);
        },

        isFile: async (path: string): Promise<boolean> => {
            try {
                return await tauriInvoke<boolean>('fs_is_file', { path });
            } catch {
                return false;
            }
        },

        isFolder: async (path: string): Promise<boolean> => {
            try {
                return await tauriInvoke<boolean>('fs_is_folder', { path });
            } catch {
                return false;
            }
        },

        rimraf: async (path: string): Promise<void> => {
            await tauriInvoke('fs_remove', { path });
        },

        mkdir: async (path: string): Promise<void> => {
            await tauriInvoke('fs_mkdir', { path });
        },

        getPathForFile: (file: File): string => {
            return (file as any).path || '';
        },

        copyFile: async (src: string, dest: string): Promise<void> => {
            await tauriInvoke('fs_copy_file', { src, dest });
        },

        readDir: async (path: string): Promise<string[]> => {
            try {
                return await tauriInvoke<string[]>('fs_read_dir', { path });
            } catch {
                return [];
            }
        },

        pathToFileUrl: (p: string): string => {
            const normalized = p.replace(/\\/g, '/');
            return `file:///${normalized.startsWith('/') ? normalized.slice(1) : normalized}`;
        },

        fileUrlToPath: (url: string): string => {
            return decodeURIComponent(url.replace(/^file:\/\/\//, ''));
        },
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = mod;
}
