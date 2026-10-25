/**
 * RadioAudioPlayer — 独立电台音频播放服务
 *
 * 与主音乐播放器（trackPlayer / playQueue）彻底隔离：
 * 1. 独立维护 HTMLAudioElement 与 Hls.js 音频实例；
 * 2. 电台播放不写入主音乐队列，不改变 currentMusicAtom；
 * 3. 电台播放时若音乐正在播放则自动暂停音乐，避免声音重叠；
 * 4. 退出电台页面时立即停止音频流播放，彻底释放资源。
 */
import Hls from 'hls.js';
import { atom, getDefaultStore, useAtomValue, type PrimitiveAtom } from 'jotai';
import type { IRadioBrowserMusicItem } from '@common/radioBrowser';
import { isSafeRadioRemoteUrl } from '@common/radioBrowser';
import requestForwarder from '@infra/requestForwarder/renderer';
import trackPlayer from '@renderer/mainWindow/core/trackPlayer';
import { playerStateAtom, store as musicStore } from '@renderer/mainWindow/core/trackPlayer/store';
import { PlayerState } from '@common/constant';
import { addToRadioHistory } from './radioHistory';

export type RadioPlaybackState = 'idle' | 'buffering' | 'playing' | 'paused' | 'error';

const store = getDefaultStore();

const savedVolume = (() => {
    try {
        const v = localStorage.getItem('radio.volume');
        return v != null ? Number(v) : 1;
    } catch {
        return 1;
    }
})();

export const radioCurrentStationAtom: PrimitiveAtom<IRadioBrowserMusicItem | null> = atom(
    null as IRadioBrowserMusicItem | null,
);
export const radioPlaybackStateAtom: PrimitiveAtom<RadioPlaybackState> = atom(
    'idle' as RadioPlaybackState,
);
export const radioVolumeAtom: PrimitiveAtom<number> = atom(isNaN(savedVolume) ? 1 : savedVolume);

export function useRadioCurrentStation(): IRadioBrowserMusicItem | null {
    return useAtomValue(radioCurrentStationAtom);
}

export function useRadioPlaybackState(): RadioPlaybackState {
    return useAtomValue(radioPlaybackStateAtom);
}

export function useRadioVolume(): number {
    return useAtomValue(radioVolumeAtom);
}

class RadioAudioPlayer {
    private audio: HTMLAudioElement;
    private hls: Hls | null = null;
    private loadSessionId = 0;

    constructor() {
        this.audio = new Audio();
        this.audio.preload = 'none';
        this.audio.volume = store.get(radioVolumeAtom);

        this.audio.onwaiting = () => {
            if (this.audio.src) {
                store.set(radioPlaybackStateAtom, 'buffering');
            }
        };

        this.audio.onplaying = () => {
            store.set(radioPlaybackStateAtom, 'playing');
            const station = store.get(radioCurrentStationAtom);
            if (station) {
                addToRadioHistory(station).catch(() => {});
            }
        };

        this.audio.onpause = () => {
            if (store.get(radioPlaybackStateAtom) === 'playing') {
                store.set(radioPlaybackStateAtom, 'paused');
            }
        };

        this.audio.onerror = () => {
            if (this.audio.src && store.get(radioPlaybackStateAtom) !== 'idle') {
                store.set(radioPlaybackStateAtom, 'error');
            }
        };
    }

    async play(station: IRadioBrowserMusicItem): Promise<void> {
        if (!isSafeRadioRemoteUrl(station.url)) {
            store.set(radioPlaybackStateAtom, 'error');
            throw new Error('Unsafe radio stream URL');
        }

        const sessionId = ++this.loadSessionId;
        this.destroyHls();
        this.audio.pause();
        this.audio.removeAttribute('src');

        // 隔离：开始播放电台时，若音乐播放器正在播放音乐，则将其暂停
        if (musicStore.get(playerStateAtom) === PlayerState.Playing) {
            trackPlayer.pause();
        }

        store.set(radioCurrentStationAtom, station);
        store.set(radioPlaybackStateAtom, 'buffering');

        const rawUrl = station.url;
        const hlsStream = this.isHls(rawUrl, station);

        if (hlsStream && Hls.isSupported()) {
            this.hls = new Hls({ enableWorker: true });
            this.hls.attachMedia(this.audio);
            this.hls.once(Hls.Events.MANIFEST_PARSED, () => {
                if (this.loadSessionId !== sessionId) return;
                this.audio.play().catch(() => {
                    if (this.loadSessionId === sessionId) {
                        store.set(radioPlaybackStateAtom, 'error');
                    }
                });
            });
            this.hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (this.loadSessionId === sessionId && data.fatal) {
                    store.set(radioPlaybackStateAtom, 'error');
                }
            });
            this.hls.loadSource(rawUrl);
            return;
        }

        const finalUrl = requestForwarder.isProxyRequired(rawUrl)
            ? requestForwarder.buildProxyUrl(rawUrl, undefined, true)
            : rawUrl;

        this.audio.src = finalUrl;
        try {
            await this.audio.play();
            if (this.loadSessionId === sessionId) {
                store.set(radioPlaybackStateAtom, 'playing');
            }
        } catch (err) {
            if (this.loadSessionId === sessionId) {
                store.set(radioPlaybackStateAtom, 'error');
                throw err;
            }
        }
    }

    pause(): void {
        this.audio.pause();
        store.set(radioPlaybackStateAtom, 'paused');
    }

    resume(): void {
        if (this.audio.src || this.hls) {
            // 播放电台时若音乐正在播放则暂停音乐
            if (musicStore.get(playerStateAtom) === PlayerState.Playing) {
                trackPlayer.pause();
            }
            this.audio.play().catch(() => {
                store.set(radioPlaybackStateAtom, 'error');
            });
        }
    }

    togglePlayPause(): void {
        const state = store.get(radioPlaybackStateAtom);
        if (state === 'playing') {
            this.pause();
        } else if (state === 'paused') {
            this.resume();
        } else {
            const station = store.get(radioCurrentStationAtom);
            if (station) {
                this.play(station).catch(() => {});
            }
        }
    }

    /** 退出电台或停止播放：立即释放音频和 Hls 资源并重置状态 */
    stop(): void {
        this.loadSessionId++;
        this.destroyHls();
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        store.set(radioPlaybackStateAtom, 'idle');
        store.set(radioCurrentStationAtom, null);
    }

    setVolume(volume: number): void {
        const clamped = Math.max(0, Math.min(1, volume));
        this.audio.volume = clamped;
        store.set(radioVolumeAtom, clamped);
        try {
            localStorage.setItem('radio.volume', String(clamped));
        } catch {
            // ignore localStorage quota errors
        }
    }

    getVolume(): number {
        return this.audio.volume;
    }

    private destroyHls(): void {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }

    private isHls(url: string, station?: IRadioBrowserMusicItem): boolean {
        if (station?.radioBrowser?.isHls === true) return true;
        try {
            return new URL(url).pathname.endsWith('.m3u8');
        } catch {
            return url.includes('.m3u8');
        }
    }
}

export const radioAudioPlayer = new RadioAudioPlayer();
