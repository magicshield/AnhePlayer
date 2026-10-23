/**
 * Tauri 桥接：fsUtil
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/fsUtil/common/constant';
import { tauriInvoke } from '../ipc';
import { hostPathSep } from '../hostPlatform';
import { fromFileUrl, toFileUrl } from '../pathUrl';

export function registerFsUtilBridge(): void {
    const mod = {
        writeFile: async (
            path: string,
            data: string | Uint8Array,
            _options?: { encoding?: string; flag?: string },
        ): Promise<void> => {
            const content = typeof data === 'string' ? data : Array.from(data);
            await tauriInvoke('fs_write_file', {
                path,
                content,
                isBinary: typeof data !== 'string',
            });
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
            } catch {
                return;
            }
        },

        mkdir: async (path: string): Promise<void> => {
            try {
                await tauriInvoke('fs_mkdir', { path });
            } catch {
                return;
            }
        },

        copyFile: async (src: string, dest: string): Promise<void> => {
            try {
                await tauriInvoke('fs_copy_file', { src, dest });
            } catch {
                return;
            }
        },

        readDir: async (path: string): Promise<string[]> => {
            try {
                return await tauriInvoke<string[]>('fs_read_dir', { path });
            } catch {
                return [];
            }
        },

        pathToFileUrl: (p: string): string => toFileUrl(p),

        addFileScheme: (filePath: string): string => {
            if (filePath.startsWith('file://')) return filePath;
            return toFileUrl(filePath);
        },

        fileUrlToPath: (fileUrl: string): string => {
            if (!fileUrl.startsWith('file://')) return fileUrl;
            return fromFileUrl(fileUrl);
        },

        normalizePath: (filePath: string): string => {
            return filePath.replace(/[/\\]+/g, hostPathSep());
        },

        pathSep: hostPathSep(),
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = mod;
}
