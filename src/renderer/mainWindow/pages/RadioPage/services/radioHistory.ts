/**
 * RadioHistory — 电台收听历史记录服务
 *
 * 存储层：IndexedDB（通过 asyncKV），完整 IRadioBrowserMusicItem 数据。
 * 内存层：jotai atom，驱动 UI 实时响应。
 * 自守护初始化：首次读写时自动加载。
 */
import { useEffect } from 'react';
import { atom, getDefaultStore } from 'jotai';
import { useAtomValue } from 'jotai/react';
import { compositeKey } from '@common/mediaKey';
import type { IRadioBrowserMusicItem } from '@common/radioBrowser';
import { asyncKV } from '@renderer/common/kvStore';
import logger from '@infra/logger/renderer';

const HARD_LIMIT = 200;
const store = getDefaultStore();
export const radioHistoryAtom = atom<IRadioBrowserMusicItem[]>([]);

let loadPromise: Promise<void> | null = null;

function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
        loadPromise = asyncKV
            .get('radioHistory')
            .then((list) => {
                store.set(radioHistoryAtom, list ?? []);
            })
            .catch((e) => {
                loadPromise = null;
                logger.warn('[radioHistory] Failed to load from IndexedDB', e);
            });
    }
    return loadPromise;
}

function stationKey(station: Pick<IRadioBrowserMusicItem, 'platform' | 'id'>): string {
    return compositeKey(station.platform, String(station.id));
}

/**
 * 添加电台到历史记录。去重 + 队首插入 + 截断。
 */
export async function addToRadioHistory(station: IRadioBrowserMusicItem): Promise<void> {
    if (!station?.id || !station?.platform) return;

    await ensureLoaded();

    const targetKey = stationKey(station);
    const current = store.get(radioHistoryAtom);
    const filtered = current.filter((item) => stationKey(item) !== targetKey);
    const next = [station, ...filtered].slice(0, HARD_LIMIT);

    store.set(radioHistoryAtom, next);
    asyncKV.set('radioHistory', next).catch((e) => {
        logger.warn('[radioHistory] Failed to persist after add', e);
    });
}

/**
 * 从电台历史记录中移除指定电台。
 */
export async function removeFromRadioHistory(
    station: Pick<IRadioBrowserMusicItem, 'platform' | 'id'>,
): Promise<void> {
    await ensureLoaded();

    const targetKey = stationKey(station);
    const current = store.get(radioHistoryAtom);
    const next = current.filter((item) => stationKey(item) !== targetKey);

    store.set(radioHistoryAtom, next);
    asyncKV.set('radioHistory', next).catch((e) => {
        logger.warn('[radioHistory] Failed to persist after remove', e);
    });
}

/**
 * 清空电台历史记录。
 */
export async function clearRadioHistory(): Promise<void> {
    await ensureLoaded();
    store.set(radioHistoryAtom, []);
    asyncKV.remove('radioHistory').catch((e) => {
        logger.warn('[radioHistory] Failed to clear', e);
    });
}

/**
 * React Hook：获取电台历史记录列表
 */
export function useRadioHistory(): IRadioBrowserMusicItem[] {
    useEffect(() => {
        ensureLoaded();
    }, []);
    return useAtomValue(radioHistoryAtom);
}
