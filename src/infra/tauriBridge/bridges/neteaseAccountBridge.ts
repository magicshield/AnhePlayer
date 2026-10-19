/**
 * Tauri 桥接：neteaseAccount
 *
 * 登录窗口与带 Cookie 的请求在 Rust 侧完成（commands/netease.rs），MUSIC_U 不会进入 JS；
 * 前端只负责 weapi 加密与业务编排（与 Electron 共用 common/core）。
 */
import { CONTEXT_BRIDGE_KEY } from '@infra/neteaseAccount/common/constant';
import {
    createNeteaseCore,
    NETEASE_REQUEST_TIMEOUT_MS,
    type INeteaseSession,
    type INeteaseTransport,
} from '@infra/neteaseAccount/common/core';
import type { INeteaseAccountBridge, INeteaseAccountStatus } from '@appTypes/infra/neteaseAccount';
import { tauriInvoke } from '../ipc';

interface INeteaseRustSession {
    loggedIn: boolean;
    csrf: string;
    loginWindowOpen: boolean;
}

/** 登录 Cookie 已存在但资料校验失败时（令牌失效），隔一会再等用户重新登录 */
const LOGIN_RECHECK_DELAY_MS = 1500;

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
        task.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

const tauriTransport: INeteaseTransport = {
    async getSession(): Promise<INeteaseSession> {
        const session = await tauriInvoke<INeteaseRustSession | null>('netease_session');
        return { loggedIn: Boolean(session?.loggedIn), csrf: session?.csrf ?? '' };
    },

    async request<T>(method: 'GET' | 'POST', pathWithQuery: string, body?: string): Promise<T> {
        // Rust 侧 reqwest 也设置了超时，这里再兜一层，避免 IPC 本身卡住时播放无法回退
        const res = await withTimeout(
            tauriInvoke<{ statusCode: number; body: string } | null>('netease_request', {
                method,
                path: pathWithQuery,
                body: body ?? null,
            }),
            NETEASE_REQUEST_TIMEOUT_MS + 2000,
            `NetEase ${pathWithQuery}`,
        );
        if (!res || res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`NetEase request failed (${pathWithQuery}): ${res?.statusCode}`);
        }
        return JSON.parse(res.body) as T;
    },
};

export function registerNeteaseAccountBridge(): void {
    const core = createNeteaseCore(tauriTransport);
    const listeners = new Set<(status: INeteaseAccountStatus) => void>();
    let loginTask: Promise<'connected' | 'cancelled'> | null = null;

    const emit = (status: INeteaseAccountStatus) => {
        for (const listener of listeners) listener(status);
    };

    const getStatus = async (force?: boolean): Promise<INeteaseAccountStatus> => {
        try {
            const profile = await core.getProfile(force);
            return { connected: Boolean(profile?.userId), profile };
        } catch {
            return { connected: false, profile: null };
        }
    };

    const runLogin = async (): Promise<'connected' | 'cancelled'> => {
        await tauriInvoke('netease_login_open');
        try {
            // 轮询放在 Rust 侧：登录窗口遮住主窗口时，页面计时器可能被节流
            while (await tauriInvoke<boolean>('netease_login_wait')) {
                const profile = await core.getProfile(true);
                if (profile?.userId) {
                    emit({ connected: true, profile });
                    return 'connected';
                }
                await new Promise((resolve) => setTimeout(resolve, LOGIN_RECHECK_DELAY_MS));
            }
            return 'cancelled';
        } finally {
            await tauriInvoke('netease_login_close').catch(() => {});
        }
    };

    const mod: INeteaseAccountBridge = {
        getStatus,

        openLogin: () => {
            if (loginTask) {
                // 已在登录中：把登录窗口提到前台，复用同一个任务
                void tauriInvoke('netease_login_open').catch(() => {});
                return loginTask;
            }
            loginTask = runLogin().finally(() => {
                loginTask = null;
            });
            return loginTask;
        },

        logout: async () => {
            core.clearCache();
            await tauriInvoke('netease_logout');
            emit({ connected: false, profile: null });
            return true;
        },

        getDailyRecommendSongs: () => core.getDailyRecommendSongs(),
        getPrivateFmSongs: () => core.getPrivateFmSongs(),
        getPrivateRadarSongs: () => core.getPrivateRadarSongs(),
        getMusicUrl: (songId, quality) => core.getMusicUrl(songId, quality),
        getLyric: (songId) => core.getLyric(songId),

        onStatusChanged: (callback) => {
            listeners.add(callback);
            return () => {
                listeners.delete(callback);
            };
        },
    };

    (window as any)[CONTEXT_BRIDGE_KEY] = mod;
}
