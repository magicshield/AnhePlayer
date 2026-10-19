import { session, type Session } from 'electron';
import { NETEASE_PARTITION } from '../common/constant';
import {
    createNeteaseCore,
    NETEASE_ORIGIN,
    NETEASE_UA,
    NETEASE_REQUEST_TIMEOUT_MS,
    type INeteaseTransport,
} from '../common/core';
import type { INeteaseAccountStatus } from '@appTypes/infra/neteaseAccount';

function getAccountSession(): Session {
    return session.fromPartition(NETEASE_PARTITION);
}

/** Electron 侧：Cookie 留在独立 partition 里，由 session.fetch 自动携带 */
const electronTransport: INeteaseTransport = {
    async getSession() {
        const cookies = await getAccountSession().cookies.get({ url: NETEASE_ORIGIN });
        const find = (name: string) => cookies.find((c) => c.name === name)?.value ?? '';
        return { loggedIn: Boolean(find('MUSIC_U')), csrf: find('__csrf') };
    },

    async request<T>(method: 'GET' | 'POST', pathWithQuery: string, body?: string): Promise<T> {
        const headers: Record<string, string> = {
            Referer: `${NETEASE_ORIGIN}/`,
            'User-Agent': NETEASE_UA,
        };
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            headers.Origin = NETEASE_ORIGIN;
        }

        const response = await getAccountSession().fetch(`${NETEASE_ORIGIN}${pathWithQuery}`, {
            method,
            headers,
            body,
            // 显式携带会话 Cookie，不依赖 Origin 头隐式判定同源
            credentials: 'include',
            signal: AbortSignal.timeout(NETEASE_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`NetEase request failed (${pathWithQuery}): ${response.status}`);
        }
        return (await response.json()) as T;
    },
};

export const neteaseCore = createNeteaseCore(electronTransport);

export async function getNeteaseAccountStatus(force = false): Promise<INeteaseAccountStatus> {
    const profile = await neteaseCore.getProfile(force);
    return { connected: Boolean(profile?.userId), profile };
}

export async function logoutNetease(): Promise<void> {
    neteaseCore.clearCache();
    const accSession = getAccountSession();
    await accSession.clearStorageData();
    await accSession.clearCache().catch(() => {});
}
