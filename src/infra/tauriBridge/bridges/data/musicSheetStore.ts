/**
 * data 层：musicSheet 的 Tauri/JS 实现
 *
 * 存储：<userData>/anhe-player-data/music-sheet.json
 * 语义对齐 src/infra/musicSheet/main/{index,queries}.ts：
 * - insertRelation 为 INSERT OR IGNORE（重复添加被忽略，保留原排序）
 * - addMusic 采用 minOrder - n 前插（列表顶部为新歌）
 * - 派生字段 worksNum / latestArtwork 与 SQL 一致
 * - 孤儿歌曲清理延迟 5s 执行
 * - 事件语义：user 事件 renderer 已乐观更新，仅刷新 sheetsAtom；
 *   internal 事件 renderer 会拉取 musicList
 */
import { nanoid } from 'nanoid';
import { INTERNAL_SLIM_KEY } from '@common/constant';
import { compositeKey } from '@common/mediaKey';
import {
    DEFAULT_FAVORITE_SHEET_ID,
    DOWNLOADED_SHEET_ID,
    MAX_MUSIC_PER_SHEET,
    MAX_QUEUE_SIZE,
    PLAY_QUEUE_SHEET_ID,
    type IMusicSheetEvent,
} from '@infra/musicSheet/common/constant';
import type {
    ICreateSheetParams,
    ILocalSheetDetail,
    ILocalSheetMeta,
    IMusicItemSlim,
    IStarredSheetItem,
    IUpdateSheetParams,
} from '@appTypes/infra/musicSheet';
import type { IBackupSheet, RestoreMode } from '@appTypes/infra/backup';
import { JsonFileStore } from './jsonFile';
import { joinPath } from './pathUtils';
import { getUserDataDir } from './tauriFs';

// ─── 存储结构 ───

interface IStoredSheet {
    id: string;
    title: string;
    artwork: string | null;
    description: string | null;
    type: 'user' | 'system';
    folderPath: string | null;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
}

interface IStoredRelation {
    sheetId: string;
    platform: string;
    musicId: string;
    sortOrder: number;
    addedAt: number;
}

interface IStoredMusicItem {
    platform: string;
    id: string;
    title: string;
    artist: string;
    album: string;
    duration: number | null;
    artwork: string | null;
    raw: string | null;
}

interface IStoredStarred {
    platform: string;
    id: string;
    title: string | null;
    artwork: string | null;
    raw: string;
    sortOrder: number;
    starredAt: number;
}

interface IMusicSheetData {
    sheets: IStoredSheet[];
    relations: IStoredRelation[];
    items: Record<string, IStoredMusicItem>;
    starred: IStoredStarred[];
}

function relKeyOf(sheetId: string, platform: string, musicId: string): string {
    return `${sheetId}\u0000${platform}\u0000${musicId}`;
}

function createDefaultData(): IMusicSheetData {
    const now = Date.now();
    return {
        sheets: [
            {
                id: DEFAULT_FAVORITE_SHEET_ID,
                title: '默认收藏',
                artwork: null,
                description: null,
                type: 'user',
                folderPath: null,
                sortOrder: -1,
                createdAt: now,
                updatedAt: now,
            },
            {
                id: PLAY_QUEUE_SHEET_ID,
                title: '播放队列',
                artwork: null,
                description: null,
                type: 'system',
                folderPath: null,
                sortOrder: -999,
                createdAt: now,
                updatedAt: now,
            },
            {
                id: DOWNLOADED_SHEET_ID,
                title: '已下载',
                artwork: null,
                description: null,
                type: 'system',
                folderPath: null,
                sortOrder: -998,
                createdAt: now,
                updatedAt: now,
            },
        ],
        relations: [],
        items: {},
        starred: [],
    };
}

type SheetEventListener = (event: IMusicSheetEvent) => void;

// ─── MusicSheetStore ───

class MusicSheetStore {
    private file = new JsonFileStore<IMusicSheetData>(
        () => joinPath(getUserDataDir(), 'anhe-player-data/music-sheet.json'),
        createDefaultData,
    );

    private ensured = false;
    private listeners = new Set<SheetEventListener>();
    private orphanCleanupTimer: ReturnType<typeof setTimeout> | null = null;

    // ─── 基础设施 ───

    private async init(): Promise<IMusicSheetData> {
        const data = await this.file.load();
        if (!this.ensured) {
            this.ensured = true;
            // 确保三个内置歌单存在（对齐 ensureDefaultSheet / ensurePlayQueueSheet / ensureDownloadedSheet）
            let changed = false;
            for (const def of createDefaultData().sheets) {
                if (!data.sheets.some((s) => s.id === def.id)) {
                    data.sheets.push(def);
                    changed = true;
                }
            }
            if (changed) this.file.scheduleSave();
        }
        return data;
    }

    private save(): void {
        this.file.scheduleSave();
    }

    public onMusicSheetEvent(cb: SheetEventListener): () => void {
        this.listeners.add(cb);
        return () => {
            this.listeners.delete(cb);
        };
    }

    private broadcast(event: IMusicSheetEvent): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch (e) {
                console.error('[musicSheet] listener error:', e);
            }
        }
    }

    /** 延迟清理不被任何歌单引用的歌曲（5s 防抖） */
    private scheduleOrphanCleanup(): void {
        if (this.orphanCleanupTimer) return;
        this.orphanCleanupTimer = setTimeout(() => {
            this.orphanCleanupTimer = null;
            if (!this.file.isLoaded()) return;
            void this.flushNow();
        }, 5000);
    }

    private async flushNow(): Promise<void> {
        const data = this.file.get();
        const referenced = new Set<string>();
        for (const rel of data.relations) {
            referenced.add(compositeKey(rel.platform, rel.musicId));
        }
        for (const key of Object.keys(data.items)) {
            if (!referenced.has(key)) {
                delete data.items[key];
            }
        }
        this.save();
    }

    // ─── 数据转换 ───

    private toStoredItem(data: IMusicSheetData, item: IMusic.IMusicItem | IMusicItemSlim): void {
        const key = compositeKey(item.platform, String(item.id));
        const existing = data.items[key];
        const isSlim = !!(item as any)[INTERNAL_SLIM_KEY];
        let raw: string | null = existing?.raw ?? null;
        if (!isSlim) {
            try {
                raw = JSON.stringify(item);
            } catch {
                /* 序列化失败保留旧值 */
            }
        }
        data.items[key] = {
            platform: item.platform,
            id: String(item.id),
            title: item.title ?? '',
            artist: item.artist ?? '',
            album: item.album ?? '',
            duration: item.duration ?? null,
            // COALESCE(excluded.artwork, artwork)：新值为空时保留旧值
            artwork: item.artwork ?? existing?.artwork ?? null,
            raw,
        };
    }

    private toSlim(item: IStoredMusicItem): IMusicItemSlim {
        return {
            platform: item.platform,
            id: item.id,
            title: item.title,
            artist: item.artist,
            album: item.album,
            duration: item.duration,
            artwork: item.artwork,
            [INTERNAL_SLIM_KEY]: true,
        } as IMusicItemSlim;
    }

    private toSheetMeta(data: IMusicSheetData, sheet: IStoredSheet): ILocalSheetMeta {
        const relations = data.relations.filter((r) => r.sheetId === sheet.id);
        let latestArtwork: string | null = null;
        if (sheet.artwork == null) {
            let bestAddedAt = -Infinity;
            for (const rel of relations) {
                const item = data.items[compositeKey(rel.platform, rel.musicId)];
                if (item?.artwork && rel.addedAt > bestAddedAt) {
                    bestAddedAt = rel.addedAt;
                    latestArtwork = item.artwork;
                }
            }
        }
        return {
            id: sheet.id,
            title: sheet.title,
            artwork: sheet.artwork,
            description: sheet.description,
            type: sheet.type,
            folderPath: sheet.folderPath,
            sortOrder: sheet.sortOrder,
            createdAt: sheet.createdAt,
            updatedAt: sheet.updatedAt,
            worksNum: relations.length,
            latestArtwork,
        };
    }

    private slimListOf(data: IMusicSheetData, sheetId: string): IMusicItemSlim[] {
        return data.relations
            .filter((r) => r.sheetId === sheetId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((r) => {
                const item = data.items[compositeKey(r.platform, r.musicId)];
                return item ? this.toSlim(item) : null;
            })
            .filter((v): v is IMusicItemSlim => v !== null);
    }

    // ─── 歌单 CRUD ───

    public async getAllSheets(): Promise<ILocalSheetMeta[]> {
        const data = await this.init();
        return data.sheets
            .filter((s) => s.type !== 'system')
            .map((s) => this.toSheetMeta(data, s))
            .sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt);
    }

    public async getSheetDetail(sheetId: string): Promise<ILocalSheetDetail | null> {
        const data = await this.init();
        const sheet = data.sheets.find((s) => s.id === sheetId);
        if (!sheet) return null;
        return {
            ...this.toSheetMeta(data, sheet),
            musicList: this.slimListOf(data, sheetId),
        };
    }

    public async createSheet(params: ICreateSheetParams): Promise<ILocalSheetMeta> {
        const data = await this.init();
        const now = Date.now();
        const sheet: IStoredSheet = {
            id: nanoid(),
            title: params.title,
            artwork: params.artwork ?? null,
            description: params.description ?? null,
            type: params.type ?? 'user',
            folderPath: params.folderPath ?? null,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
        };
        data.sheets.push(sheet);
        this.save();
        this.broadcast({ origin: 'user' });
        return { ...sheet, worksNum: 0, latestArtwork: null };
    }

    public async deleteSheet(sheetId: string): Promise<void> {
        if (sheetId === DEFAULT_FAVORITE_SHEET_ID) {
            throw new Error('无法删除默认收藏歌单');
        }
        if (sheetId === PLAY_QUEUE_SHEET_ID) {
            throw new Error('无法删除系统歌单');
        }
        const data = await this.init();
        data.relations = data.relations.filter((r) => r.sheetId !== sheetId);
        data.sheets = data.sheets.filter((s) => s.id !== sheetId);
        this.scheduleOrphanCleanup();
        this.save();
        this.broadcast({ origin: 'user' });
    }

    public async updateSheet(params: IUpdateSheetParams): Promise<void> {
        const data = await this.init();
        const sheet = data.sheets.find((s) => s.id === params.id);
        if (!sheet) return;
        // 未提供字段或显式传 null 时，保留现有字段值
        sheet.title = params.title ?? sheet.title;
        sheet.artwork = params.artwork ?? sheet.artwork;
        sheet.description = params.description ?? sheet.description;
        sheet.sortOrder = params.sortOrder ?? sheet.sortOrder;
        sheet.updatedAt = Date.now();
        this.save();
        this.broadcast({ origin: 'user' });
    }

    public async clearSheet(sheetId: string): Promise<void> {
        const data = await this.init();
        data.relations = data.relations.filter((r) => r.sheetId !== sheetId);
        this.scheduleOrphanCleanup();
        this.save();
        this.broadcast({ origin: 'user', sheetId });
    }

    // ─── 歌曲操作 ───

    public async addMusic(
        sheetId: string,
        musicItems: Array<IMusic.IMusicItem | IMusicItemSlim>,
    ): Promise<{ added: number; truncated: number }> {
        const data = await this.init();
        const currentCount = data.relations.reduce(
            (acc, r) => acc + (r.sheetId === sheetId ? 1 : 0),
            0,
        );
        const remaining = MAX_MUSIC_PER_SHEET - currentCount;
        if (remaining <= 0) {
            throw new Error(`歌单歌曲数量已达上限（${MAX_MUSIC_PER_SHEET}）`);
        }
        const toAdd = musicItems.slice(0, remaining);

        const relSet = new Set(
            data.relations.map((r) => relKeyOf(r.sheetId, r.platform, r.musicId)),
        );
        // MIN(sort_order) COALESCE 0
        let minOrder = 0;
        let hasRel = false;
        for (const r of data.relations) {
            if (r.sheetId === sheetId && (!hasRel || r.sortOrder < minOrder)) {
                minOrder = r.sortOrder;
                hasRel = true;
            }
        }
        const startOrder = minOrder - toAdd.length;
        const now = Date.now();

        for (let i = 0; i < toAdd.length; i++) {
            const item = toAdd[i];
            this.toStoredItem(data, item);
            const key = relKeyOf(sheetId, item.platform, String(item.id));
            if (!relSet.has(key)) {
                relSet.add(key);
                data.relations.push({
                    sheetId,
                    platform: item.platform,
                    musicId: String(item.id),
                    sortOrder: startOrder + i,
                    addedAt: now,
                });
            }
        }

        this.save();
        this.broadcast({ origin: 'user', sheetId });
        return { added: toAdd.length, truncated: musicItems.length - toAdd.length };
    }

    public async removeMusic(sheetId: string, musicBases: IMedia.IMediaBase[]): Promise<void> {
        const data = await this.init();
        const kill = new Set(musicBases.map((b) => relKeyOf('', b.platform, String(b.id))));
        data.relations = data.relations.filter(
            (r) => !(r.sheetId === sheetId && kill.has(relKeyOf('', r.platform, r.musicId))),
        );
        this.scheduleOrphanCleanup();
        this.save();
        this.broadcast({ origin: 'user', sheetId });
    }

    public async removeFromAllSheets(musicBases: IMedia.IMediaBase[]): Promise<void> {
        const data = await this.init();
        const kill = new Set(musicBases.map((b) => relKeyOf('', b.platform, String(b.id))));
        data.relations = data.relations.filter(
            (r) =>
                r.sheetId === PLAY_QUEUE_SHEET_ID || !kill.has(relKeyOf('', r.platform, r.musicId)),
        );
        this.scheduleOrphanCleanup();
        this.save();
        this.broadcast({ origin: 'user' });
    }

    public async updateMusicOrder(
        sheetId: string,
        orderedKeys: IMedia.IMediaBase[],
    ): Promise<void> {
        const data = await this.init();
        const orderIndex = new Map<string, number>();
        for (let i = 0; i < orderedKeys.length; i++) {
            orderIndex.set(relKeyOf('', orderedKeys[i].platform, String(orderedKeys[i].id)), i);
        }
        for (const rel of data.relations) {
            if (rel.sheetId !== sheetId) continue;
            const idx = orderIndex.get(relKeyOf('', rel.platform, rel.musicId));
            if (idx !== undefined) rel.sortOrder = idx;
        }
        this.save();
    }

    public async getRawMusicItem(platform: string, id: string): Promise<IMusic.IMusicItem | null> {
        const data = await this.init();
        const item = data.items[compositeKey(platform, String(id))];
        if (!item?.raw) return null;
        try {
            return JSON.parse(item.raw);
        } catch {
            return null;
        }
    }

    public async getRawMusicItems(keys: IMedia.IMediaBase[]): Promise<IMusic.IMusicItem[]> {
        const data = await this.init();
        const results: IMusic.IMusicItem[] = [];
        for (const key of keys) {
            const item = data.items[compositeKey(key.platform, String(key.id))];
            if (item?.raw) {
                try {
                    results.push(JSON.parse(item.raw));
                } catch {
                    /* 跳过损坏数据 */
                }
            }
        }
        return results;
    }

    // ─── 星标远程歌单 ───

    public async getStarredSheets(): Promise<IStarredSheetItem[]> {
        const data = await this.init();
        return [...data.starred].sort(
            (a, b) => a.sortOrder - b.sortOrder || b.starredAt - a.starredAt,
        );
    }

    public async starSheet(sheet: IMusic.IMusicSheetItem): Promise<void> {
        const data = await this.init();
        const id = String(sheet.id);
        const entry: IStoredStarred = {
            platform: sheet.platform,
            id,
            title: sheet.title ?? null,
            artwork: sheet.artwork ?? null,
            raw: JSON.stringify(sheet),
            sortOrder: 0,
            starredAt: Date.now(),
        };
        const idx = data.starred.findIndex(
            (s) => s.platform === entry.platform && s.id === entry.id,
        );
        if (idx >= 0) {
            data.starred[idx] = entry;
        } else {
            data.starred.push(entry);
        }
        this.save();
    }

    public async unstarSheet(platform: string, id: string): Promise<void> {
        const data = await this.init();
        data.starred = data.starred.filter(
            (s) => !(s.platform === platform && s.id === String(id)),
        );
        this.save();
    }

    public async setStarredOrder(orderedKeys: IMedia.IMediaBase[]): Promise<void> {
        const data = await this.init();
        const orderIndex = new Map<string, number>();
        for (let i = 0; i < orderedKeys.length; i++) {
            orderIndex.set(relKeyOf('', orderedKeys[i].platform, String(orderedKeys[i].id)), i);
        }
        for (const entry of data.starred) {
            const idx = orderIndex.get(relKeyOf('', entry.platform, entry.id));
            if (idx !== undefined) entry.sortOrder = idx;
        }
        this.save();
    }

    // ─── 播放队列 ───

    public async playQueueGetAll(): Promise<IMusicItemSlim[]> {
        const data = await this.init();
        return this.slimListOf(data, PLAY_QUEUE_SHEET_ID);
    }

    public async playQueueSet(items: IMusic.IMusicItem[], fromSheetId?: string): Promise<void> {
        const data = await this.init();
        data.relations = data.relations.filter((r) => r.sheetId !== PLAY_QUEUE_SHEET_ID);
        const now = Date.now();

        if (fromSheetId) {
            // 性能优化：直接从源歌单复制 relation（保留 sortOrder）
            const source = data.relations
                .filter((r) => r.sheetId === fromSheetId)
                .sort((a, b) => a.sortOrder - b.sortOrder);
            for (const rel of source) {
                data.relations.push({
                    sheetId: PLAY_QUEUE_SHEET_ID,
                    platform: rel.platform,
                    musicId: rel.musicId,
                    sortOrder: rel.sortOrder,
                    addedAt: now,
                });
            }
        } else {
            const toAdd = items.slice(0, MAX_QUEUE_SIZE);
            for (let i = 0; i < toAdd.length; i++) {
                const item = toAdd[i];
                this.toStoredItem(data, item);
                data.relations.push({
                    sheetId: PLAY_QUEUE_SHEET_ID,
                    platform: item.platform,
                    musicId: String(item.id),
                    sortOrder: i,
                    addedAt: now,
                });
            }
        }

        this.scheduleOrphanCleanup();
        this.save();
    }

    public async playQueueAdd(items: IMusic.IMusicItem[], afterIndex: number): Promise<void> {
        const data = await this.init();
        const kill = new Set(items.map((it) => relKeyOf('', it.platform, String(it.id))));

        // 1. 去重：移除队列中已存在的同名歌曲
        data.relations = data.relations.filter(
            (r) =>
                !(
                    r.sheetId === PLAY_QUEUE_SHEET_ID &&
                    kill.has(relKeyOf('', r.platform, r.musicId))
                ),
        );

        // 2. 在去重后的有序队列中定位插入点（对齐 SQL：pivot 及之后后移）
        const queue = data.relations
            .filter((r) => r.sheetId === PLAY_QUEUE_SHEET_ID)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        const insertAt = Math.max(0, Math.min(afterIndex, queue.length));

        const now = Date.now();
        const newRels: IStoredRelation[] = [];
        for (const item of items) {
            this.toStoredItem(data, item);
            newRels.push({
                sheetId: PLAY_QUEUE_SHEET_ID,
                platform: item.platform,
                musicId: String(item.id),
                sortOrder: 0,
                addedAt: now,
            });
        }
        queue.splice(insertAt, 0, ...newRels);
        queue.forEach((rel, i) => {
            rel.sortOrder = i;
        });

        // 3. 合并回 relations（其他歌单数据不动）
        data.relations = [
            ...data.relations.filter((r) => r.sheetId !== PLAY_QUEUE_SHEET_ID),
            ...queue,
        ];
        this.save();
    }

    public async playQueueRemove(musicBases: IMedia.IMediaBase[]): Promise<void> {
        const data = await this.init();
        const kill = new Set(musicBases.map((b) => relKeyOf('', b.platform, String(b.id))));
        data.relations = data.relations.filter(
            (r) =>
                !(
                    r.sheetId === PLAY_QUEUE_SHEET_ID &&
                    kill.has(relKeyOf('', r.platform, r.musicId))
                ),
        );
        this.scheduleOrphanCleanup();
        this.save();
    }

    public async playQueueClear(): Promise<void> {
        const data = await this.init();
        data.relations = data.relations.filter((r) => r.sheetId !== PLAY_QUEUE_SHEET_ID);
        this.scheduleOrphanCleanup();
        this.save();
    }

    // ─── 内部 API（供 downloadStore / backupStore 消费，不对外暴露） ───

    /** 下载完成 → upsert 到 __downloaded__（internal 事件） */
    public async addMusicToDownloaded(item: IMusic.IMusicItem): Promise<void> {
        const data = await this.init();
        const key = relKeyOf(DOWNLOADED_SHEET_ID, item.platform, String(item.id));
        const exists = data.relations.some(
            (r) => relKeyOf(r.sheetId, r.platform, r.musicId) === key,
        );
        this.toStoredItem(data, item);
        if (!exists) {
            let minOrder = 0;
            let hasRel = false;
            for (const r of data.relations) {
                if (r.sheetId === DOWNLOADED_SHEET_ID && (!hasRel || r.sortOrder < minOrder)) {
                    minOrder = r.sortOrder;
                    hasRel = true;
                }
            }
            data.relations.push({
                sheetId: DOWNLOADED_SHEET_ID,
                platform: item.platform,
                musicId: String(item.id),
                sortOrder: minOrder - 1,
                addedAt: Date.now(),
            });
        }
        this.save();
        this.broadcast({ origin: 'internal', sheetId: DOWNLOADED_SHEET_ID });
    }

    /** 删除下载 → 从 __downloaded__ 移除（internal 事件） */
    public async removeFromDownloaded(platform: string, musicId: string): Promise<void> {
        const data = await this.init();
        const key = relKeyOf(DOWNLOADED_SHEET_ID, platform, String(musicId));
        data.relations = data.relations.filter(
            (r) => relKeyOf(r.sheetId, r.platform, r.musicId) !== key,
        );
        this.scheduleOrphanCleanup();
        this.save();
        this.broadcast({ origin: 'internal', sheetId: DOWNLOADED_SHEET_ID });
    }

    /** 所有可导出歌单（排除 system） */
    public async getExportableSheets(): Promise<Array<{ id: string; title: string }>> {
        const data = await this.init();
        return data.sheets
            .filter((s) => s.type !== 'system')
            .map((s) => ({ id: s.id, title: s.title }));
    }

    /** 歌单内全量 raw 数据（导出用，跳过无 raw 的条目） */
    public async getSheetMusicRaw(sheetId: string): Promise<IMusic.IMusicItem[]> {
        const data = await this.init();
        const results: IMusic.IMusicItem[] = [];
        const relations = data.relations
            .filter((r) => r.sheetId === sheetId)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        for (const rel of relations) {
            const item = data.items[compositeKey(rel.platform, rel.musicId)];
            if (item?.raw) {
                try {
                    results.push(JSON.parse(item.raw));
                } catch {
                    /* 跳过损坏数据 */
                }
            }
        }
        return results;
    }

    /** 导入歌单，支持覆盖或追加 */
    public async importSheets(
        sheets: IBackupSheet[],
        mode: RestoreMode,
        onProgress?: (current: number, total: number, sheetTitle: string) => void,
    ): Promise<{ sheetsCount: number; songsCount: number }> {
        const data = await this.init();

        if (mode === 'overwrite') {
            const userSheets = data.sheets.filter(
                (s) => s.type !== 'system' && s.id !== DEFAULT_FAVORITE_SHEET_ID,
            );
            const killedIds = new Set(userSheets.map((s) => s.id));
            data.relations = data.relations.filter(
                (r) => !killedIds.has(r.sheetId) && r.sheetId !== DEFAULT_FAVORITE_SHEET_ID,
            );
            data.sheets = data.sheets.filter((s) => !killedIds.has(s.id));
        }

        let totalSongs = 0;
        let sheetsCount = 0;

        for (let i = 0; i < sheets.length; i++) {
            const sheet = sheets[i];
            onProgress?.(i + 1, sheets.length, sheet.title);
            // 让出事件循环，保证大量导入时进度 UI 可刷新
            await new Promise((resolve) => setTimeout(resolve, 0));

            let targetSheetId: string;
            if (sheet.id === DEFAULT_FAVORITE_SHEET_ID) {
                targetSheetId = DEFAULT_FAVORITE_SHEET_ID;
            } else {
                targetSheetId = nanoid();
                const now = Date.now();
                data.sheets.push({
                    id: targetSheetId,
                    title: sheet.title,
                    artwork: null,
                    description: null,
                    type: 'user',
                    folderPath: null,
                    sortOrder: 0,
                    createdAt: now,
                    updatedAt: now,
                });
            }

            let maxOrder = 0;
            for (const rel of data.relations) {
                if (rel.sheetId === targetSheetId && rel.sortOrder > maxOrder) {
                    maxOrder = rel.sortOrder;
                }
            }
            const relSet = new Set(
                data.relations.map((r) => relKeyOf(r.sheetId, r.platform, r.musicId)),
            );
            const now = Date.now();
            for (const item of sheet.musicList ?? []) {
                this.toStoredItem(data, item);
                const key = relKeyOf(targetSheetId, item.platform, String(item.id));
                if (!relSet.has(key)) {
                    relSet.add(key);
                    maxOrder += 1;
                    data.relations.push({
                        sheetId: targetSheetId,
                        platform: item.platform,
                        musicId: String(item.id),
                        sortOrder: maxOrder,
                        addedAt: now,
                    });
                }
            }
            totalSongs += (sheet.musicList ?? []).length;
            sheetsCount += 1;
        }

        this.scheduleOrphanCleanup();
        this.save();
        this.broadcast({ origin: 'internal' });
        return { sheetsCount, songsCount: totalSongs };
    }

    /** 供 lyricAdapter 等外部模块复用的 provider（与 IMod.getRawMusicItem 等价） */
    public getMusicItemProvider() {
        return {
            getRawMusicItem: (platform: string, id: string) => this.getRawMusicItem(platform, id),
        };
    }
}

export const musicSheetStore = new MusicSheetStore();
