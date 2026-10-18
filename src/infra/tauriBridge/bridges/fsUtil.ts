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
            try {
                await tauriInvoke('fs_remove', { path });
            } catch {}
        },

        mkdir: async (path: string): Promise<void> => {
            try {
                await tauriInvoke('fs_mkdir', { path });
            } catch {}
        },

        getPathForFile: (file: File): string => {
            return (file as any).path || '';
        },

        copyFile: async (src: string, dest: string): Promise<void> => {
            try {
                await tauriInvoke('fs_copy_file', { src, dest });
            } catch {}
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

        addFileScheme: (filePath: string): string => {
            if (filePath.startsWith('file://')) return filePath;
            const normalized = filePath.replace(/\\/g, '/');
            return `file:///${normalized.startsWith('/') ? normalized.slice(1) : normalized}`;
        },

        fileUrlToPath: (fileUrl: string): string => {
            if (!fileUrl.startsWith('file://')) return fileUrl;
            let p = fileUrl.replace(/^file:\/\/\/?/, '');
            p = decodeURIComponent(p);
            return p.replace(/\//g, '\\');
        },

        normalizePath: (filePath: string): string => {
            return filePath.replace(/[\/\\]+/g, '\\');
        },

        pathSep: '\\',
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = mod;
}
