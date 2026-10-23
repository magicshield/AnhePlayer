/**
 * data 层小工具：对 Tauri fs 命令的薄封装（全部容错，不抛出）
 */
import { tauriInvoke } from '../../ipc';

export async function readTextFile(path: string): Promise<string | null> {
    try {
        const res = await tauriInvoke<string>('fs_read_file', { path, encoding: 'utf-8' });
        return typeof res === 'string' ? res : null;
    } catch {
        return null;
    }
}

export async function writeTextFile(path: string, content: string): Promise<boolean> {
    try {
        await tauriInvoke('fs_write_file', { path, content, isBinary: false });
        return true;
    } catch {
        return false;
    }
}

export async function ensureDir(path: string): Promise<void> {
    if (!path) return;
    try {
        await tauriInvoke('fs_mkdir', { path });
    } catch {
        /* 已存在或创建失败，忽略 */
    }
}

export async function isFile(path: string): Promise<boolean> {
    try {
        return !!(await tauriInvoke<boolean>('fs_is_file', { path }));
    } catch {
        return false;
    }
}

export async function isFolder(path: string): Promise<boolean> {
    try {
        return !!(await tauriInvoke<boolean>('fs_is_folder', { path }));
    } catch {
        return false;
    }
}

export async function removePath(path: string): Promise<void> {
    try {
        await tauriInvoke('fs_remove', { path });
    } catch {
        /* 不存在等情况忽略 */
    }
}

export async function renamePath(src: string, dest: string): Promise<void> {
    await tauriInvoke('fs_rename', { src, dest });
}

/** 当前 userData 目录（globalContext 同步默认值即可用，异步回填后为准） */
export function getUserDataDir(): string {
    const ctx = (globalThis as any).globalContext;
    const value = ctx?.appPath?.userData;
    return typeof value === 'string' && value ? value : '';
}
