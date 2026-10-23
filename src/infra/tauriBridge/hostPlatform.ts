/**
 * 宿主操作系统判定（同步、无 IPC）
 *
 * Tauri 桥接层在模块求值阶段就需要分隔符等平台差异，
 * 而 globalContext 由 Rust 异步回填，因此这里直接读 WebView UA。
 */

let cached: boolean | null = null;

export function isWindowsHost(): boolean {
    if (cached !== null) {
        return cached;
    }
    if (typeof navigator === 'undefined') {
        return true;
    }
    const ua = navigator.userAgent || '';
    cached = /Windows|Win32|Win64/i.test(ua) || /^win/.test(navigator.platform || '');
    return cached;
}

/** 当前平台的原生路径分隔符，与 Electron 下 path.sep 对齐 */
export function hostPathSep(): string {
    return isWindowsHost() ? '\\' : '/';
}

/** Node/Electron 语义下的 platform 字面量（前端按 'win32' / 'darwin' / 'linux' 分支） */
export function hostPlatform(): string {
    if (isWindowsHost()) {
        return 'win32';
    }
    if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac|iPhone|iPad/i.test(platform)) {
            return 'darwin';
        }
    }
    return 'linux';
}
