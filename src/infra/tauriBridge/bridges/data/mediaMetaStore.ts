/**
 * data 层：mediaMeta 的 Tauri/JS 实现
 *
 * 存储：<userData>/anhe-player-data/media-meta.json
 * - RFC 7396 JSON Merge Patch：patch 值为 null 时删除该字段
 * - 每次 setMeta / deleteMeta 广播 media-meta-changed 事件（本地监听器）
 * - downloadData.path 反查大小写不敏感（对齐 SQLite COLLATE NOCASE）
 */
import { compositeKey } from '@common/mediaKey';
import type { IMediaMeta, IMediaMetaChangeEvent, MediaMetaPatch } from '@appTypes/infra/mediaMeta';
import { JsonFileStore } from './jsonFile';
import { joinPath } from './pathUtils';
import { getUserDataDir } from './tauriFs';

interface IStoredMetaEntry {
    platform: string;
    musicId: string;
    data: IMediaMeta;
    updatedAt: number;
}

interface IMediaMetaData {
    entries: Record<string, IStoredMetaEntry>;
}

function createDefaultData(): IMediaMetaData {
    return { entries: {} };
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

type MetaChangeListener = (event: IMediaMetaChangeEvent) => void;

class MediaMetaStore {
    private file = new JsonFileStore<IMediaMetaData>(
        () => joinPath(getUserDataDir(), 'anhe-player-data/media-meta.json'),
        createDefaultData,
    );

    private listeners = new Set<MetaChangeListener>();

    private async init(): Promise<IMediaMetaData> {
        return this.file.load();
    }

    public onMetaChanged(cb: MetaChangeListener): () => void {
        this.listeners.add(cb);
        return () => {
            this.listeners.delete(cb);
        };
    }

    private broadcast(event: IMediaMetaChangeEvent): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch (e) {
                console.error('[mediaMeta] listener error:', e);
            }
        }
    }

    // ─── IPC 契约方法 ───

    public async getMeta(platform: string, musicId: string): Promise<IMediaMeta | null> {
        const data = await this.init();
        const entry = data.entries[compositeKey(platform, String(musicId))];
        return entry ? deepClone(entry.data) : null;
    }

    /** 返回 [compositeKey, meta] 元组数组（与 renderer 缓存键对齐） */
    public async batchGetMeta(
        keys: Array<{ platform: string; musicId: string }>,
    ): Promise<Array<[string, IMediaMeta]>> {
        const data = await this.init();
        const result: Array<[string, IMediaMeta]> = [];
        for (const { platform, musicId } of keys) {
            const key = compositeKey(platform, String(musicId));
            const entry = data.entries[key];
            if (entry) {
                result.push([key, deepClone(entry.data)]);
            }
        }
        return result;
    }

    public async setMeta(platform: string, musicId: string, patch: MediaMetaPatch): Promise<void> {
        const data = await this.init();
        const key = compositeKey(platform, String(musicId));
        const existing = data.entries[key]?.data ?? ({} as IMediaMeta);
        const merged: Record<string, unknown> = { ...existing };

        for (const [field, value] of Object.entries(patch)) {
            if (value === null) {
                delete merged[field];
            } else {
                merged[field] = value;
            }
        }

        const mergedMeta = merged as IMediaMeta;
        data.entries[key] = {
            platform,
            musicId: String(musicId),
            data: mergedMeta,
            updatedAt: Date.now(),
        };
        this.file.scheduleSave();
        this.broadcast({ platform, musicId: String(musicId), meta: deepClone(mergedMeta) });
    }

    public async deleteMeta(platform: string, musicId: string): Promise<void> {
        const data = await this.init();
        delete data.entries[compositeKey(platform, String(musicId))];
        this.file.scheduleSave();
        this.broadcast({ platform, musicId: String(musicId), meta: null });
    }

    public async queryByField(
        field: string,
    ): Promise<Array<{ platform: string; musicId: string; meta: IMediaMeta }>> {
        const data = await this.init();
        const result: Array<{ platform: string; musicId: string; meta: IMediaMeta }> = [];
        for (const entry of Object.values(data.entries)) {
            // 对齐 json_extract(data, '$.field') IS NOT NULL（顶层字段）
            if ((entry.data as Record<string, unknown>)[field] != null) {
                result.push({
                    platform: entry.platform,
                    musicId: entry.musicId,
                    meta: deepClone(entry.data),
                });
            }
        }
        return result;
    }

    // ─── 内部 API（供 downloadStore / localMusicStore 消费） ───

    public async getDownloadData(
        platform: string,
        musicId: string,
    ): Promise<{ path: string; quality: IMusic.IQualityKey } | null> {
        const meta = await this.getMeta(platform, musicId);
        return meta?.downloadData ?? null;
    }

    public async getAllDownloaded(): Promise<
        Array<{ platform: string; musicId: string; path: string; quality: IMusic.IQualityKey }>
    > {
        const data = await this.init();
        const result: Array<{
            platform: string;
            musicId: string;
            path: string;
            quality: IMusic.IQualityKey;
        }> = [];
        for (const entry of Object.values(data.entries)) {
            const downloadData = entry.data?.downloadData;
            if (downloadData?.path) {
                result.push({
                    platform: entry.platform,
                    musicId: entry.musicId,
                    path: downloadData.path,
                    quality: downloadData.quality,
                });
            }
        }
        return result;
    }

    /** 通过下载路径反查（大小写不敏感，对齐 COLLATE NOCASE） */
    public async getMetaByDownloadPath(
        filePath: string,
    ): Promise<{ platform: string; musicId: string } | null> {
        const data = await this.init();
        const target = filePath.toLowerCase();
        for (const entry of Object.values(data.entries)) {
            const path = entry.data?.downloadData?.path;
            if (path && path.toLowerCase() === target) {
                return { platform: entry.platform, musicId: entry.musicId };
            }
        }
        return null;
    }

    public async getAssociatedLyric(
        platform: string,
        musicId: string,
    ): Promise<IMediaMeta['associatedLyric'] | null> {
        const meta = await this.getMeta(platform, musicId);
        return meta?.associatedLyric ?? null;
    }
}

export const mediaMetaStore = new MediaMetaStore();
