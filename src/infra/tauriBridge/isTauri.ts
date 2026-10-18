/**
 * 判断当前是否运行在 Tauri 宿主环境中
 */
export function isTauriEnvironment(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    return Boolean(
        '__TAURI_INTERNALS__' in window ||
        '__TAURI__' in window ||
        (window as any).__TAURI_METADATA__
    );
}
