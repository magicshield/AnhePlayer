/**
 * data 层：localMusic 的 Tauri/JS 实现（对齐 Electron 主进程语义）
 *
 * 存储：<userData>/anhe-player-data/local-music.json
 * - 增量扫描：Rust local_scan_dir 递归发现 → 与曲库 diff（mtime + size）→
 *   Rust local_parse_meta 解析新增/变更文件 → 写库；磁盘缺失文件删除记录
 * - 扫描串行队列（全局同一时刻最多一个 scanFolder）
 * - 下载反查：命中 mediaMeta.download_path 时复用原始 platform + id
 * - 启动后 60s 空闲静默 rescan
 *
 * 与 Electron 版差异：deleteItems 仅移除曲库记录，不移动/删除磁盘文件
 * （Tauri 无回收站 API）。
 */
import { nanoid } from 'nanoid';
import {
    INTERNAL_SLIM_KEY,
    LOCAL_PLUGIN_NAME,
    SUPPORTED_AUDIO_EXTS,
} from '@common/constant';
import { CONTEXT_BRIDGE_KEY as APP_CONFIG_KEY } from '@infra/appConfig/common/constant';
import type {
    ILocalMusicItem,
    IScanFolder,
    IScanProgress,
    IScanResult,
} from '@appTypes/infra/localMusic';
import type { IAppConfig } from '@appTypes/infra/appConfig';
import { JsonFileStore } from './jsonFile';
import { mediaMetaStore } from './mediaMetaStore';
import { baseNameNoExt, dirnameOf, fileUrlFromPath, joinPath, pathKey } from './pathUtils';
import { getUserDataDir } from './tauriFs';
import { tauriInvoke } from '../../ipc';

interface ILocalMusicData {
    folders: IScanFolder[];
    items: ILocalMusicItem[];
}

function createDefaultData(): ILocalMusicData {
    return { folders: [], items: [] };
}

/** 路径稳定哈希（FNV-1a 双通道，替代 md5 作为纯本地歌曲 id） */
function hashPath(input: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x2166136b;
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

interface IRustFileInfo {
    path: string;
    size: number;
    mtime: number;
}

interface IRustAudioMeta {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    duration?: number | null;
}

type LibraryChangedListener = () => void;
type ScanProgressListener = (progress: IScanProgress) => void;

class LocalMusicStore {
    private file = new JsonFileStore<ILocalMusicData>(
        () => joinPath(getUserDataDir(), 'anhe-player-data/local-music.json'),
        createDefaultData,
    );

    private config: IAppConfig = {};
    private initialized = false;

    private libraryListeners = new Set<LibraryChangedListener>();
    private scanProgressListeners = new Set<ScanProgressListener>();

    private scanning = false;
    private scanQueue: Array<{
        folderId: string;
        folderPath: string;
        resolve: (result: IScanResult) => void;
        reject: (error: unknown) => void;
    }> = [];

    // ─── 基础设施 ───

    private async init(): Promise<ILocalMusicData> {
        const data = await this.file.load();
        if (!this.initialized) {
            this.initialized = true;
            await this.refreshConfig();
            // 启动后 60s 空闲静默 rescan（对齐 Electron）
            setTimeout(() => {
                void this.idleRescan();
            }, 60_000);
        }
        return data;
    }

    private async refreshConfig(): Promise<IAppConfig> {
        try {
            const appConfigMod = (window as any)[APP_CONFIG_KEY];
            if (appConfigMod?.syncConfig) {
                const next = await appConfigMod.syncConfig();
                if (next && typeof next === 'object') this.config = next;
            }
        } catch {
            /* 保留旧值 */
        }
        return this.config;
    }

    public onLibraryChanged(cb: LibraryChangedListener): () => void {
        this.libraryListeners.add(cb);
        return () => {
            this.libraryListeners.delete(cb);
        };
    }

    public onScanProgress(cb: ScanProgressListener): () => void {
        this.scanProgressListeners.add(cb);
        return () => {
            this.scanProgressListeners.delete(cb);
        };
    }

    private broadcastLibraryChanged(): void {
        for (const listener of [...this.libraryListeners]) {
            try {
                listener();
            } catch (e) {
                console.error('[localMusic] library listener error:', e);
            }
        }
    }

    private broadcastScanProgress(progress: IScanProgress): void {
        for (const listener of [...this.scanProgressListeners]) {
            try {
                listener(progress);
            } catch (e) {
                console.error('[localMusic] scan progress listener error:', e);
            }
        }
    }

    // ─── IPC 契约方法 ───

    /** 全量歌曲（IMusicItem[]，供 renderer 缓存） */
    public async getAllMusicItems(): Promise<IMusic.IMusicItem[]> {
        const data = await this.init();
        return [...data.items]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((row) => this.toMusicItem(row));
    }

    public async getScanFolders(): Promise<IScanFolder[]> {
        const data = await this.init();
        return [...data.folders].sort((a, b) => a.createdAt - b.createdAt);
    }

    /** 同步扫描文件夹列表并触发扫描（对齐 Electron syncScanFolders 语义） */
    public async syncScanFolders(folderPaths: string[]): Promise<IScanResult> {
        await this.refreshConfig();
        const data = await this.init();

        const inputMap = new Map<string, string>();
        for (const fp of folderPaths) {
            inputMap.set(pathKey(fp), fp);
        }
        const existingMap = new Map(data.folders.map((f) => [pathKey(f.folderPath), f]));

        // diff：新增 / 移除
        const toAdd: string[] = [];
        for (const [key, fp] of inputMap) {
            if (!existingMap.has(key)) toAdd.push(fp);
        }
        const toRemove = [...existingMap.values()].filter(
            (f) => !inputMap.has(pathKey(f.folderPath)),
        );

        for (const folder of toRemove) {
            data.folders = data.folders.filter((f) => f.id !== folder.id);
            data.items = data.items.filter((i) => i.scanFolderId !== folder.id);
            // 取消队列中待扫描的同文件夹任务
            const queued = this.scanQueue.findIndex((q) => q.folderId === folder.id);
            if (queued !== -1) {
                const [removed] = this.scanQueue.splice(queued, 1);
                removed.resolve({ added: 0, updated: 0, removed: 0, unchanged: 0, elapsed: 0 });
            }
        }
        for (const fp of toAdd) {
            data.folders.push({
                id: nanoid(),
                folderPath: fp,
                lastScanAt: null,
                createdAt: Date.now(),
            });
        }
        this.file.scheduleSave();

        // 扫描全部最终文件夹（新增 + 保留）
        const total: IScanResult = { added: 0, updated: 0, removed: 0, unchanged: 0, elapsed: 0 };
        const finalFolders = [...data.folders];
        for (const folder of finalFolders) {
            const result = await this.enqueueScan(folder.id, folder.folderPath);
            total.added += result.added;
            total.updated += result.updated;
            total.removed += result.removed;
            total.unchanged += result.unchanged;
            total.elapsed += result.elapsed;
            folder.lastScanAt = Date.now();
        }
        this.file.scheduleSave();
        this.broadcastLibraryChanged();
        return total;
    }

    /** 删除本地歌曲：仅移除曲库记录（不触碰磁盘文件） */
    public async deleteItems(musicBases: IMedia.IMediaBase[]): Promise<void> {
        const data = await this.init();
        const kill = new Set(musicBases.map((b) => `${b.platform}\u0000${String(b.id)}`));
        data.items = data.items.filter(
            (item) => !kill.has(`${item.platform}\u0000${String(item.id)}`),
        );
        this.file.scheduleSave();
        this.broadcastLibraryChanged();
    }

    // ─── 扫描队列 ───

    private enqueueScan(folderId: string, folderPath: string): Promise<IScanResult> {
        return new Promise<IScanResult>((resolve, reject) => {
            this.scanQueue.push({ folderId, folderPath, resolve, reject });
            void this.drainQueue();
        });
    }

    private async drainQueue(): Promise<void> {
        if (this.scanning || this.scanQueue.length === 0) {
            return;
        }
        const next = this.scanQueue.shift()!;
        this.scanning = true;
        try {
            next.resolve(await this.scanSingleFolder(next.folderId, next.folderPath));
        } catch (error) {
            next.reject(error);
        } finally {
            this.scanning = false;
            void this.drainQueue();
        }
    }

    // ─── 核心：增量扫描 ───

    private async scanSingleFolder(folderId: string, folderPath: string): Promise<IScanResult> {
        const startTime = Date.now();
        const excludedPaths = this.config['localMusic.excludedPaths'] ?? [];

        try {
            // Phase 1: 发现文件（Rust 侧递归，不跟随符号链接）
            this.broadcastScanProgress({ phase: 'discovering', scanned: 0, total: 0 });
            const diskFiles =
                (await tauriInvoke<IRustFileInfo[]>('local_scan_dir', {
                    folderPath,
                    excludedPaths,
                    extensions: [...SUPPORTED_AUDIO_EXTS],
                })) ?? [];

            // Phase 2: 与曲库 diff
            this.broadcastScanProgress({ phase: 'diffing', scanned: 0, total: diskFiles.length });
            const data = await this.init();
            const dbRows = data.items.filter((i) => i.scanFolderId === folderId);
            const dbMap = new Map(dbRows.map((r) => [r.filePath, r]));
            const diskSet = new Set(diskFiles.map((f) => f.path));

            const added: IRustFileInfo[] = [];
            const changed: IRustFileInfo[] = [];
            let unchanged = 0;
            for (const file of diskFiles) {
                const existing = dbMap.get(file.path);
                if (!existing) {
                    added.push(file);
                } else if (
                    existing.fileSize !== file.size ||
                    existing.fileMtime !== Math.floor(file.mtime)
                ) {
                    changed.push(file);
                } else {
                    unchanged += 1;
                }
            }
            const removed = dbRows
                .filter((r) => !diskSet.has(r.filePath))
                .map((r) => r.filePath);

            // Phase 3: 解析新增/变更文件并写库
            const toProcess = [...added, ...changed];
            for (let i = 0; i < toProcess.length; i++) {
                const file = toProcess[i];
                try {
                    const item = await this.parseFileMetadata(
                        file.path,
                        file.size,
                        file.mtime,
                        folderId,
                    );
                    const idx = data.items.findIndex((it) => it.filePath === file.path);
                    if (idx >= 0) {
                        data.items[idx] = item;
                    } else {
                        data.items.push(item);
                    }
                } catch {
                    /* 跳过解析失败的文件 */
                }

                this.broadcastScanProgress({
                    phase: 'parsing',
                    scanned: i + 1,
                    total: toProcess.length,
                    current: file.path,
                });
                // 每 50 个让出事件循环并落盘
                if (i % 50 === 49) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    this.file.scheduleSave();
                }
            }

            // Phase 4: 删除已不存在的文件记录
            if (removed.length > 0) {
                const removedSet = new Set(removed);
                data.items = data.items.filter((i) => !removedSet.has(i.filePath));
            }

            this.file.scheduleSave();
            this.broadcastScanProgress({ phase: 'done', scanned: 0, total: 0 });
            return {
                added: added.length,
                updated: changed.length,
                removed: removed.length,
                unchanged,
                elapsed: Date.now() - startTime,
            };
        } catch {
            return {
                added: 0,
                updated: 0,
                removed: 0,
                unchanged: 0,
                elapsed: Date.now() - startTime,
            };
        }
    }

    /** 解析单个文件元数据（下载反查 → 标签解析 → 文件名兜底） */
    private async parseFileMetadata(
        filePath: string,
        fileSize: number,
        fileMtime: number,
        scanFolderId: string,
    ): Promise<ILocalMusicItem> {
        // 1. download_path 反查：命中则复用原始 platform + id
        const linked = await mediaMetaStore.getMetaByDownloadPath(filePath);
        const platform = linked?.platform ?? LOCAL_PLUGIN_NAME;
        const id = linked?.musicId ?? hashPath(filePath);

        // 2. 标签解析（失败走文件名兜底）
        let meta: IRustAudioMeta = {};
        try {
            meta = (await tauriInvoke<IRustAudioMeta>('local_parse_meta', { filePath })) ?? {};
        } catch {
            /* 解析失败忽略 */
        }

        return {
            filePath,
            platform,
            id,
            title: meta.title || baseNameNoExt(filePath),
            artist: meta.artist ?? '',
            album: meta.album ?? '',
            duration: meta.duration ?? null,
            artwork: null,
            folder: dirnameOf(filePath),
            fileSize,
            fileMtime: Math.floor(fileMtime),
            scanFolderId,
            createdAt: Date.now(),
        };
    }

    /** local_music → IMusicItem（对齐 Electron toMusicItem） */
    private toMusicItem(row: ILocalMusicItem): IMusic.IMusicItem {
        if (row.platform === LOCAL_PLUGIN_NAME) {
            return {
                platform: row.platform,
                id: row.id,
                title: row.title,
                artist: row.artist,
                album: row.album,
                duration: row.duration ?? undefined,
                artwork: row.artwork ?? undefined,
                url: fileUrlFromPath(row.filePath),
                localPath: row.filePath,
                folder: row.folder,
            } as IMusic.IMusicItem;
        }
        return {
            platform: row.platform,
            id: row.id,
            title: row.title,
            artist: row.artist,
            album: row.album,
            duration: row.duration ?? undefined,
            artwork: row.artwork ?? undefined,
            [INTERNAL_SLIM_KEY]: true,
            folder: row.folder,
            localPath: row.filePath,
        } as IMusic.IMusicItem;
    }

    /** 空闲 rescan：启动后 60s 扫描所有文件夹，有变化才广播 */
    private async idleRescan(): Promise<void> {
        const data = await this.init();
        const folders = [...data.folders];
        if (folders.length === 0) return;

        let hasChanges = false;
        for (const folder of folders) {
            try {
                const result = await this.enqueueScan(folder.id, folder.folderPath);
                if (result.added > 0 || result.updated > 0 || result.removed > 0) {
                    folder.lastScanAt = Date.now();
                    hasChanges = true;
                }
            } catch {
                /* 静默扫描失败不影响正常使用 */
            }
        }
        this.file.scheduleSave();
        if (hasChanges) {
            this.broadcastLibraryChanged();
        }
    }
}

export const localMusicStore = new LocalMusicStore();
