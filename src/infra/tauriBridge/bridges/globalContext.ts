/**
 * Tauri 桥接：globalContext
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/globalContext/common/constant';
import { tauriInvoke } from '../ipc';
import { hostPathSep, hostPlatform, isWindowsHost } from '../hostPlatform';

/**
 * Rust 回填前的兜底上下文。
 * 路径字段仅占位，但 platform / isWin10OrAbove 会被同步读取（窗口能力判断等），
 * 必须按宿主平台给出，否则 macOS 上会短暂以 Windows 语义渲染。
 */
function buildDefaultContext() {
    const win = isWindowsHost();
    const sep = hostPathSep();
    const home = win ? 'C:\\Users\\Default' : '/Users/Shared';
    return {
        appVersion: '0.0.0',
        appPath: {
            defaultDownloadPath: `${home}${sep}Downloads`,
            temp: win ? `${home}\\AppData\\Local\\Temp` : '/tmp',
            userData: win ? `${home}\\AppData\\Roaming\\AnhePlayer` : `${home}/AnhePlayer`,
            res: '',
        },
        platform: hostPlatform(),
        isWin10OrAbove: win,
    };
}

const defaultContext = buildDefaultContext();

// ─── 就绪信号（Rust 回填真实路径/版本完成） ───

let readyResolve: (() => void) | null = null;
const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
});

function markReady() {
    if (readyResolve) {
        const resolve = readyResolve;
        readyResolve = null;
        resolve();
    }
}

// 超时兜底：任何环境最多等待 3 秒，绝不阻塞数据层加载
setTimeout(markReady, 3000);

/** 等待 Rust 回填真实 globalContext（最长 3 秒兜底） */
export function whenGlobalContextReady(): Promise<void> {
    return readyPromise;
}

// 同步初始化默认上下文，确保任何模块在加载求值时都能安全访问
if (typeof window !== 'undefined') {
    (window as any)[CONTEXT_BRIDGE_KEY] = { ...defaultContext };
    (globalThis as any).globalContext = (window as any)[CONTEXT_BRIDGE_KEY];
}

export function registerGlobalContextBridge(): void {
    if (typeof window !== 'undefined') {
        (window as any)[CONTEXT_BRIDGE_KEY] = { ...defaultContext };
        (globalThis as any).globalContext = (window as any)[CONTEXT_BRIDGE_KEY];
    }

    // 异步更新远程 Rust 计算的动态系统真实路径
    tauriInvoke('global_context_get')
        .then((remoteContext) => {
            if (remoteContext && typeof remoteContext === 'object') {
                Object.assign((window as any)[CONTEXT_BRIDGE_KEY], remoteContext);
                (globalThis as any).globalContext = (window as any)[CONTEXT_BRIDGE_KEY];
            }
            markReady();
        })
        .catch(() => {
            markReady();
        });
}
