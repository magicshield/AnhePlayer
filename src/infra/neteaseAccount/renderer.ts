import { useState, useEffect } from 'react';
import { CONTEXT_BRIDGE_KEY } from './common/constant';
import type {
    INeteaseAccountBridge,
    INeteaseAccountStatus,
    INeteaseMediaSource,
    INeteaseLyricResult,
    INeteaseRadarResult,
} from '@appTypes/infra/neteaseAccount';

// Electron 由 preload 注入，Tauri 由 tauriBridge/autoInject 同步注入
const mod = (typeof window !== 'undefined'
    ? (window as any)[CONTEXT_BRIDGE_KEY]
    : undefined) as unknown as INeteaseAccountBridge | undefined;

class NeteaseAccountRenderer {
    public async getStatus(force?: boolean): Promise<INeteaseAccountStatus> {
        if (!mod) return { connected: false, profile: null };
        return mod.getStatus(force);
    }

    public async openLogin(): Promise<'connected' | 'cancelled'> {
        if (!mod) return 'cancelled';
        return mod.openLogin();
    }

    public async logout(): Promise<boolean> {
        if (!mod) return false;
        return mod.logout();
    }

    public async getDailyRecommendSongs(): Promise<IMusic.IMusicItem[]> {
        if (!mod) return [];
        return mod.getDailyRecommendSongs();
    }

    public async getPrivateFmSongs(): Promise<IMusic.IMusicItem[]> {
        if (!mod) return [];
        return mod.getPrivateFmSongs();
    }

    public async getPrivateRadarSongs(): Promise<INeteaseRadarResult> {
        if (!mod) return { songs: [] };
        return mod.getPrivateRadarSongs();
    }

    public async getMusicUrl(
        songId: string,
        quality?: IMusic.IQualityKey,
    ): Promise<INeteaseMediaSource | null> {
        if (!mod) return null;
        return mod.getMusicUrl(songId, quality);
    }

    public async getLyric(songId: string): Promise<INeteaseLyricResult | null> {
        if (!mod) return null;
        return mod.getLyric(songId);
    }

    public onStatusChanged(callback: (status: INeteaseAccountStatus) => void): () => void {
        if (!mod) return () => {};
        return mod.onStatusChanged(callback);
    }
}

const neteaseAccount = new NeteaseAccountRenderer();
export default neteaseAccount;

/**
 * React Hook: 监听网易云音乐账号状态
 */
export function useNeteaseAccountStatus(): INeteaseAccountStatus {
    const [status, setStatus] = useState<INeteaseAccountStatus>({
        connected: false,
        profile: null,
    });

    useEffect(() => {
        let mounted = true;
        void neteaseAccount.getStatus().then((res) => {
            if (mounted) setStatus(res);
        });

        const unsub = neteaseAccount.onStatusChanged((newStatus) => {
            if (mounted) setStatus(newStatus);
        });

        return () => {
            mounted = false;
            unsub();
        };
    }, []);

    return status;
}
