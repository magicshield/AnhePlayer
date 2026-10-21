/**
 * TrackPlayer — jotai atoms + AppSync 桥接
 */
import { atom, getDefaultStore, type PrimitiveAtom } from 'jotai';
import type { IMusicItemSlim } from '@appTypes/infra/musicSheet';
import { PlayerState, RepeatMode } from '@common/constant';
import type { ICurrentLyric } from './types';

const store = getDefaultStore();

// ─── Atoms ───

export const currentMusicAtom: PrimitiveAtom<IMusicItemSlim | null> = atom(
    null as IMusicItemSlim | null,
);
export const musicQueueAtom: PrimitiveAtom<IMusicItemSlim[]> = atom<IMusicItemSlim[]>([]);
export const playerStateAtom: PrimitiveAtom<PlayerState> = atom<PlayerState>(PlayerState.None);
export const repeatModeAtom: PrimitiveAtom<RepeatMode> = atom<RepeatMode>(RepeatMode.Queue);
export const progressAtom: PrimitiveAtom<{ currentTime: number; duration: number }> = atom<{
    currentTime: number;
    duration: number;
}>({
    currentTime: 0,
    duration: Infinity,
});
export const volumeAtom: PrimitiveAtom<number> = atom<number>(1);
export const speedAtom: PrimitiveAtom<number> = atom<number>(1);
export const qualityAtom: PrimitiveAtom<IMusic.IQualityKey> = atom<IMusic.IQualityKey>('standard');
export const currentLyricAtom: PrimitiveAtom<ICurrentLyric | null> = atom(
    null as ICurrentLyric | null,
);

/** 实际播放来源：自动换源后会与当前歌曲平台不同 */
export interface IPlaybackSourceInfo {
    /** 实际提供音频的平台 */
    platform: string;
    /** 是否为播放失败后的自动换源 */
    fallback: boolean;
    /** 原歌曲平台（自动换源时记录） */
    originalPlatform?: string;
}

export const playbackSourceAtom: PrimitiveAtom<IPlaybackSourceInfo | null> = atom<IPlaybackSourceInfo | null>(
    null as IPlaybackSourceInfo | null,
);
export const associatedLyricAtom: PrimitiveAtom<IMusic.IMusicItem | null> = atom(
    null as IMusic.IMusicItem | null,
);

export { store };
