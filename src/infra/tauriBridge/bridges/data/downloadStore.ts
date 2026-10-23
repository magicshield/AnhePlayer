/**
 * data 层：downloadManager 的 Tauri/JS 实现
 *
 * 存储：<userData>/anhe-player-data/download-tasks.json
 * - 任务生命周期：pending → downloading → completed（完成后删除任务行，写入
 *   __downloaded__ 歌单 + mediaMeta）/ paused / error
 * - 断点续传：Rust download_file(resume=true) 读取临时文件大小
 * - 并发控制：download.concurrency 配置（默认 5）
 * - 世代号（taskGeneration）拦截 pause/remove 后的过时回调
 * - 进度事件：监听 Rust tauri-download-progress，按 200ms 节流批量转发
 *
 * - 标签写入：任务完成后异步调用 Rust write_audio_meta 嵌入封面与歌词（尽力而为，失败不阻断）
 */
import { nanoid } from 'nanoid';
import { QUALITY_KEYS, INTERNAL_SLIM_KEY } from '@common/constant';
import sanitizeFileName from '@common/sanitizeFileName';
import delay from '@common/delay';
import { safeParse, safeStringify } from '@common/safeSerialize';
import { CONTEXT_BRIDGE_KEY as PLUGIN_KEY } from '@infra/pluginManager/common/constant';
import { CONTEXT_BRIDGE_KEY as APP_CONFIG_KEY } from '@infra/appConfig/common/constant';
import type {
    IDownloadProgress,
    IDownloadTask,
    IDownloadTaskEvent,
    IAddDownloadParams,
} from '@appTypes/infra/downloadManager';
import type { IMusicItemSlim } from '@appTypes/infra/musicSheet';
import type { IGetMediaSourceResult } from '@appTypes/infra/pluginManager';
import type { IAppConfig } from '@appTypes/infra/appConfig';
import { JsonFileStore } from './jsonFile';
import { mediaMetaStore } from './mediaMetaStore';
import { musicSheetStore } from './musicSheetStore';
import { joinPath, extOf, dirnameOf } from './pathUtils';
import { getUserDataDir, isFile, removePath, renamePath, ensureDir } from './tauriFs';
import { tauriInvoke, tauriListen } from '../../ipc';

/** MIME → 文件扩展名映射（对齐 downloadTask.ts） */
const MIME_TO_EXT: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
    'audio/ogg': '.ogg',
    'application/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/webm': '.webm',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
};

/** 支持嵌入封面/歌词的扩展名（lofty 可写 picture 与歌词字段的容器格式） */
const TAG_WRITE_EXTS = new Set(['.mp3', '.m4a', '.flac', '.ogg', '.opus']);

interface IDownloadData {
    tasks: IDownloadTask[];
}

function createDefaultData(): IDownloadData {
    return { tasks: [] };
}

function cloneTask(task: IDownloadTask): IDownloadTask {
    return JSON.parse(JSON.stringify(task)) as IDownloadTask;
}

type ProgressListener = (data: { tasks: IDownloadProgress[] }) => void;
type TaskEventListener = (event: IDownloadTaskEvent) => void;

class DownloadStore {
    private file = new JsonFileStore<IDownloadData>(
        () => joinPath(getUserDataDir(), 'anhe-player-data/download-tasks.json'),
        createDefaultData,
    );

    private config: IAppConfig = {};
    private initialized = false;

    private progressListeners = new Set<ProgressListener>();
    private taskEventListeners = new Set<TaskEventListener>();

    private progressCache = new Map<string, IDownloadProgress>();
    private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
    private rustListenerReady = false;

    /** 活跃执行（taskId → Promise）：pause/remove 时等待其真正退出，避免新旧写入冲突 */
    private activeExecutions = new Map<string, Promise<void>>();
    /** 世代号：pause/remove/retry 时递增，使过时的异步回调失效 */
    private taskGeneration = new Map<string, number>();

    private pendingQueue: string[] = [];
    private runningCount = 0;

    // ─── 基础设施 ───

    private async init(): Promise<IDownloadData> {
        const data = await this.file.load();
        if (!this.initialized) {
            this.initialized = true;
            await this.refreshConfig();

            // 启动恢复：downloading/pending → paused（对齐 recoverTasks）
            const now = Date.now();
            let changed = false;
            for (const task of data.tasks) {
                if (task.status === 'downloading' || task.status === 'pending') {
                    task.status = 'paused';
                    task.updatedAt = now;
                    changed = true;
                }
            }
            if (changed) this.file.scheduleSave();

            this.ensureRustProgressListener();
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

    private getConcurrency(): number {
        const value = this.config['download.concurrency'];
        return typeof value === 'number' && value > 0 ? value : 5;
    }

    private ensureRustProgressListener(): void {
        if (this.rustListenerReady) return;
        this.rustListenerReady = true;
        tauriListen<{
            taskId: string;
            downloadedBytes: number;
            totalBytes: number | null;
            speed: number;
        }>('tauri-download-progress', (payload) => {
            if (!payload?.taskId) return;
            if (this.file.isLoaded()) {
                const task = this.file.get().tasks.find((t) => t.id === payload.taskId);
                if (task) {
                    task.downloadedBytes = payload.downloadedBytes;
                    if (payload.totalBytes != null) task.totalBytes = payload.totalBytes;
                }
            }
            this.progressCache.set(payload.taskId, {
                id: payload.taskId,
                downloadedBytes: payload.downloadedBytes,
                totalBytes: payload.totalBytes ?? 0,
                speed: payload.speed,
            });
            this.scheduleProgressBroadcast();
        }).catch(() => {});
    }

    private scheduleProgressBroadcast(): void {
        if (this.broadcastTimer) return;
        this.broadcastTimer = setTimeout(() => {
            this.broadcastTimer = null;
            if (this.progressCache.size === 0) return;
            const tasks = Array.from(this.progressCache.values());
            this.progressCache.clear();
            for (const listener of [...this.progressListeners]) {
                try {
                    listener({ tasks });
                } catch (e) {
                    console.error('[download] progress listener error:', e);
                }
            }
        }, 200);
    }

    private emitTaskEvent(event: IDownloadTaskEvent): void {
        for (const listener of [...this.taskEventListeners]) {
            try {
                listener(event);
            } catch (e) {
                console.error('[download] task event listener error:', e);
            }
        }
    }

    public onProgress(cb: ProgressListener): () => void {
        this.progressListeners.add(cb);
        return () => {
            this.progressListeners.delete(cb);
        };
    }

    public onTaskEvent(cb: TaskEventListener): () => void {
        this.taskEventListeners.add(cb);
        return () => {
            this.taskEventListeners.delete(cb);
        };
    }

    // ─── 任务添加 ───

    public async addTask(params: IAddDownloadParams): Promise<IDownloadTask> {
        await this.refreshConfig();
        const data = await this.init();
        const musicItem = params.musicItem;

        const targetQuality =
            params.quality ?? this.config['download.defaultQuality'] ?? 'standard';
        const downloadPath =
            this.config['download.path'] ||
            (globalThis as any).globalContext?.appPath?.defaultDownloadPath ||
            getUserDataDir();

        const platform = musicItem.platform;
        const musicId = String(musicItem.id);

        // M1: 已有活跃任务（pending/downloading/paused/error）→ 直接复用
        const existingActive = data.tasks.find(
            (t) => t.platform === platform && t.musicId === musicId && t.status !== 'completed',
        );
        if (existingActive) return cloneTask(existingActive);

        // C1: 已下载 → 拒绝重复添加
        const existingDownload = await mediaMetaStore.getDownloadData(platform, musicId);
        if (existingDownload) {
            throw new Error('该歌曲已下载');
        }

        const fileName = this.buildFileName(musicItem as IMusic.IMusicItem);
        const filePath = joinPath(downloadPath, fileName);
        const now = Date.now();
        const id = nanoid();

        const task: IDownloadTask = {
            id,
            platform,
            musicId,
            title: musicItem.title ?? '',
            artist: musicItem.artist ?? '',
            album: musicItem.album ?? '',
            quality: targetQuality,
            status: 'pending',
            filePath,
            tempPath: `${filePath}.${id}.downloading`,
            totalBytes: 0,
            downloadedBytes: 0,
            mediaSource: null,
            musicItemRaw: safeStringify(musicItem),
            error: null,
            createdAt: now,
            updatedAt: now,
        };

        data.tasks.push(task);
        this.file.scheduleSave();
        this.enqueueTask(task.id);
        this.emitTaskEvent({ task: cloneTask(task), type: 'added' });
        return cloneTask(task);
    }

    public async addTasksBatch(params: {
        musicItems: Array<IMusic.IMusicItem | IMusicItemSlim>;
        quality?: IMusic.IQualityKey;
    }): Promise<IDownloadTask[]> {
        const results = await Promise.allSettled(
            params.musicItems.map((item) =>
                this.addTask({ musicItem: item, quality: params.quality }),
            ),
        );
        return results
            .filter((r): r is PromiseFulfilledResult<IDownloadTask> => r.status === 'fulfilled')
            .map((r) => r.value);
    }

    // ─── 队列与执行 ───

    private enqueueTask(taskId: string): void {
        if (!this.pendingQueue.includes(taskId)) {
            this.pendingQueue.push(taskId);
        }
        void this.pump();
    }

    private async pump(): Promise<void> {
        const data = await this.init();
        const concurrency = this.getConcurrency();
        while (this.runningCount < concurrency && this.pendingQueue.length > 0) {
            const taskId = this.pendingQueue.shift()!;
            const task = data.tasks.find((t) => t.id === taskId);
            if (!task || task.status !== 'pending') continue;

            const generation = this.taskGeneration.get(taskId) ?? 0;
            this.runningCount += 1;
            const execution = this.runTask(task, generation)
                .catch(() => {
                    /* runTask 内部已处理错误 */
                })
                .finally(() => {
                    this.runningCount -= 1;
                    this.activeExecutions.delete(taskId);
                    void this.pump();
                });
            this.activeExecutions.set(taskId, execution);
        }
    }

    private isStale(taskId: string, generation: number): boolean {
        return (this.taskGeneration.get(taskId) ?? 0) !== generation;
    }

    private async fetchMediaSource(
        musicItem: IMusic.IMusicItem,
        quality: IMusic.IQualityKey,
    ): Promise<IGetMediaSourceResult | null> {
        const pluginMod = (window as any)[PLUGIN_KEY];
        if (!pluginMod) throw new Error('插件系统不可用');
        const plugins = (await pluginMod.getAllPlugins()) as IPlugin.IPluginDelegate[];
        const plugin = plugins.find((p) => p.platform === musicItem.platform);
        if (!plugin) throw new Error(`未找到平台插件：${musicItem.platform}`);
        return (await pluginMod.getMediaSource({
            hash: plugin.hash,
            musicItem,
            quality,
            qualityOrder: QUALITY_KEYS,
            qualityFallbackOrder: this.config['download.whenQualityMissing'] ?? 'lower',
        })) as IGetMediaSourceResult | null;
    }

    /**
     * 嵌入封面/歌词标签
     * - 封面上抛 artwork URL，由 Rust 侧直接下载（http_request 仅支持文本，二进制走不了）；
     *   封面取自 musicItem.artwork（网络 URL），歌词经插件适配器取 rawLrc
     * - 失败仅告警，不影响已完成的下载
     */
    private async embedMetadata(
        task: IDownloadTask,
        musicItem: IMusic.IMusicItem | null,
    ): Promise<void> {
        try {
            if (!musicItem || !task.filePath) return;
            if (!TAG_WRITE_EXTS.has(extOf(task.filePath))) return;

            let lyrics: string | null = null;
            try {
                const pluginMod = (window as any)[PLUGIN_KEY];
                const lyricSource = await pluginMod?.getLyric?.(musicItem);
                if (lyricSource?.rawLrc) lyrics = lyricSource.rawLrc as string;
            } catch (err) {
                console.warn('[download] 获取歌词失败:', err);
            }

            const coverUrl =
                typeof musicItem.artwork === 'string' && /^https?:\/\//i.test(musicItem.artwork)
                    ? musicItem.artwork
                    : null;

            if (!lyrics && !coverUrl) return;

            await tauriInvoke('write_audio_meta', {
                filePath: task.filePath,
                coverUrl,
                lyrics,
            });
        } catch (err) {
            console.warn('[download] 写入封面/歌词标签失败:', err);
        }
    }

    private async runTask(task: IDownloadTask, generation: number): Promise<void> {
        await this.init();
        if (this.isStale(task.id, generation) || task.status !== 'pending') return;

        // 1. 解析完整 musicItem（slim → raw）
        let musicItem = safeParse<IMusic.IMusicItem>(task.musicItemRaw ?? '');
        if (musicItem && (musicItem as any)[INTERNAL_SLIM_KEY]) {
            const full = await musicSheetStore.getRawMusicItem(
                musicItem.platform,
                String(musicItem.id),
            );
            if (full) {
                musicItem = full;
                task.musicItemRaw = safeStringify(full);
            }
        }

        // 2. 延迟获取媒体源（任务真正开始执行时才请求；失败自动重试一次，插件可能刚装好/处于瞬时空档）
        let sourceError = '';
        if (musicItem && !task.mediaSource) {
            for (let attempt = 0; attempt < 2 && !task.mediaSource; attempt += 1) {
                if (attempt > 0) await delay(800);
                if (this.isStale(task.id, generation)) return;
                try {
                    const source = await this.fetchMediaSource(musicItem, task.quality);
                    if (source?.url) {
                        task.mediaSource = safeStringify(source);
                        if (source.quality && source.quality !== task.quality) {
                            task.quality = source.quality;
                        }
                    } else {
                        sourceError = '插件未返回可用音源';
                    }
                } catch (err: any) {
                    sourceError = err?.message ?? String(err);
                }
            }
            if (sourceError) {
                console.warn('[download] 获取歌曲源失败:', sourceError);
            }
        }

        if (this.isStale(task.id, generation)) return;

        // 3. 无媒体源 → 标记错误
        if (!task.mediaSource) {
            task.status = 'error';
            task.error = sourceError ? `无法获取歌曲源：${sourceError}` : '无法获取歌曲源';
            task.updatedAt = Date.now();
            this.file.scheduleSave();
            this.emitTaskEvent({ task: cloneTask(task), type: 'error' });
            return;
        }

        // 4. 开始下载
        task.status = 'downloading';
        task.updatedAt = Date.now();
        this.file.scheduleSave();
        this.emitTaskEvent({ task: cloneTask(task), type: 'status-changed' });

        const baseFilePath = task.filePath ?? '';
        const source = safeParse<{
            url: string;
            headers?: Record<string, string>;
            userAgent?: string;
        }>(task.mediaSource) ?? { url: '' };

        const headers: Record<string, string> = { ...(source.headers ?? {}) };
        if (source.userAgent) headers['User-Agent'] = source.userAgent;

        try {
            // 确保下载目录存在
            const parentDir = dirnameOf(task.tempPath!);
            if (parentDir) {
                await ensureDir(parentDir);
            }

            const result = await tauriInvoke<{
                contentType: string | null;
                downloadedBytes: number;
                totalBytes: number | null;
            }>('download_file', {
                taskId: task.id,
                url: source.url,
                path: task.tempPath,
                headers,
                resume: true,
            });

            if (this.isStale(task.id, generation)) return;

            // 5. 扩展名推断 + 重名避让 + rename
            const mime = (result?.contentType ?? '').split(';')[0].trim().toLowerCase();
            const ext = MIME_TO_EXT[mime] ?? '.mp3';
            const finalPath = await this.resolveFinalPath(baseFilePath, ext);
            await renamePath(task.tempPath!, finalPath);
            task.filePath = finalPath;

            // 6. 原子收尾
            const completed = await this.completeDownload(task, musicItem, baseFilePath);
            // 7. 嵌入封面/歌词标签（尽力而为，不阻断任务完成）
            if (completed) {
                void this.embedMetadata(task, musicItem);
            }
        } catch (err: any) {
            const message = err?.message ?? String(err);
            // 用户取消（pause/remove/retry 已处理状态），静默退出
            if (message.includes('cancelled')) return;
            if (this.isStale(task.id, generation)) return;

            task.status = 'error';
            task.error = message;
            task.updatedAt = Date.now();
            this.file.scheduleSave();
            this.emitTaskEvent({ task: cloneTask(task), type: 'error' });
        }
    }

    private async completeDownload(
        task: IDownloadTask,
        musicItem: IMusic.IMusicItem | null,
        baseFilePath: string,
    ): Promise<boolean> {
        const data = await this.init();
        task.status = 'completed';
        task.updatedAt = Date.now();
        try {
            // 1. 写入 __downloaded__ 歌单
            if (musicItem) {
                await musicSheetStore.addMusicToDownloaded(musicItem);
            }
            // 2. 写入 mediaMeta（下载路径 + 音质）
            await mediaMetaStore.setMeta(task.platform, task.musicId, {
                downloadData: {
                    path: task.filePath!,
                    quality: task.quality,
                },
            });
            // 3. 删除已完成任务行（不保留完成记录）
            data.tasks = data.tasks.filter((t) => t.id !== task.id);
            this.file.scheduleSave();
            this.emitTaskEvent({ task: cloneTask(task), type: 'completed' });
            return true;
        } catch (err: any) {
            // 收尾失败：清理已 rename 的孤立文件 + 恢复原始路径供重试
            if (task.filePath) await removePath(task.filePath);
            task.filePath = baseFilePath || null;
            task.status = 'error';
            task.error = `下载完成但入库失败：${err?.message ?? err}`;
            task.updatedAt = Date.now();
            this.file.scheduleSave();
            this.emitTaskEvent({ task: cloneTask(task), type: 'error' });
            return false;
        }
    }

    /** 从 Content-Type 推断扩展名，重名自动追加数字后缀 */
    private async resolveFinalPath(base: string, ext: string): Promise<string> {
        let candidate = base + ext;
        let suffix = 1;
        while (await isFile(candidate)) {
            candidate = `${base} (${suffix})${ext}`;
            suffix += 1;
            if (suffix > 500) break;
        }
        return candidate;
    }

    /** 构建文件名（不含扩展名，完成后按 Content-Type 追加） */
    private buildFileName(musicItem: IMusic.IMusicItem): string {
        const artist = musicItem.artist || 'Unknown';
        const title = musicItem.title || 'Unknown';
        const format = this.config['download.filenameFormat'] ?? 'title-artist';
        const fileName =
            format === 'title-artist' ? `${title} - ${artist}` : `${artist} - ${title}`;
        return sanitizeFileName(fileName, 170);
    }

    // ─── 任务控制 ───

    public async pauseTask(taskId: string): Promise<void> {
        const data = await this.init();
        const task = data.tasks.find((t) => t.id === taskId);
        if (!task) return;
        if (task.status === 'paused') return;

        this.taskGeneration.set(taskId, (this.taskGeneration.get(taskId) ?? 0) + 1);
        this.pendingQueue = this.pendingQueue.filter((id) => id !== taskId);
        task.status = 'paused';
        task.updatedAt = Date.now();
        this.file.scheduleSave();
        this.emitTaskEvent({ task: cloneTask(task), type: 'status-changed' });

        // 中止 Rust 侧执行（500ms 内退出），等待执行真正结束再返回
        tauriInvoke('download_cancel', { taskId }).catch(() => {});
        const execution = this.activeExecutions.get(taskId);
        if (execution) {
            try {
                await execution;
            } catch {
                /* ignore */
            }
        }
    }

    public async resumeTask(taskId: string): Promise<void> {
        const data = await this.init();
        const task = data.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== 'paused') return;

        // 清空 mediaSource 强制延迟到执行时重新获取
        task.mediaSource = null;
        task.status = 'pending';
        task.error = null;
        task.updatedAt = Date.now();
        this.file.scheduleSave();
        this.enqueueTask(taskId);
        this.emitTaskEvent({ task: cloneTask(task), type: 'status-changed' });
    }

    public async retryTask(taskId: string): Promise<void> {
        const data = await this.init();
        const task = data.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== 'error') return;

        // 删除旧临时文件，确保干净重试
        if (task.tempPath) {
            await removePath(task.tempPath);
        }
        task.mediaSource = null;
        task.status = 'pending';
        task.error = null;
        task.downloadedBytes = 0;
        task.totalBytes = 0;
        task.updatedAt = Date.now();
        this.file.scheduleSave();
        this.enqueueTask(taskId);
        this.emitTaskEvent({ task: cloneTask(task), type: 'status-changed' });
    }

    public async removeTask(taskId: string): Promise<void> {
        const data = await this.init();
        const task = data.tasks.find((t) => t.id === taskId);

        this.taskGeneration.set(taskId, (this.taskGeneration.get(taskId) ?? 0) + 1);
        this.pendingQueue = this.pendingQueue.filter((id) => id !== taskId);
        tauriInvoke('download_cancel', { taskId }).catch(() => {});
        const execution = this.activeExecutions.get(taskId);
        if (execution) {
            try {
                await execution;
            } catch {
                /* ignore */
            }
        }

        if (task?.tempPath) {
            await removePath(task.tempPath);
        }
        data.tasks = data.tasks.filter((t) => t.id !== taskId);
        this.file.scheduleSave();
        if (task) {
            this.emitTaskEvent({ task: cloneTask(task), type: 'removed' });
        }
    }

    /** 删除已完成的下载（本地文件 + 歌单 + mediaMeta） */
    public async removeDownload(
        platform: string,
        musicId: string,
        deleteFile = true,
    ): Promise<void> {
        const downloadData = await mediaMetaStore.getDownloadData(platform, musicId);
        if (!downloadData) return;

        if (deleteFile) {
            await removePath(downloadData.path);
        }
        await musicSheetStore.removeFromDownloaded(platform, musicId);
        await mediaMetaStore.setMeta(platform, musicId, { downloadData: null });

        const synthetic: IDownloadTask = {
            id: '',
            platform,
            musicId,
            title: '',
            artist: '',
            album: '',
            quality: 'standard',
            status: 'completed',
            filePath: downloadData.path,
            tempPath: null,
            totalBytes: 0,
            downloadedBytes: 0,
            mediaSource: null,
            musicItemRaw: null,
            error: null,
            createdAt: 0,
            updatedAt: 0,
        };
        this.emitTaskEvent({ task: synthetic, type: 'removed' });
    }

    public async pauseAll(): Promise<void> {
        const data = await this.init();
        const ids = data.tasks
            .filter((t) => t.status === 'pending' || t.status === 'downloading')
            .map((t) => t.id);
        await Promise.all(ids.map((id) => this.pauseTask(id)));
    }

    public async resumeAll(): Promise<void> {
        const data = await this.init();
        const ids = data.tasks.filter((t) => t.status === 'paused').map((t) => t.id);
        await Promise.all(ids.map((id) => this.resumeTask(id)));
    }

    // ─── 查询 ───

    public async getTasks(
        page: number,
        pageSize: number,
    ): Promise<{ data: IDownloadTask[]; total: number }> {
        const data = await this.init();
        const sorted = [...data.tasks].sort((a, b) => b.createdAt - a.createdAt);
        const offset = (page - 1) * pageSize;
        return {
            data: sorted.slice(offset, offset + pageSize).map(cloneTask),
            total: sorted.length,
        };
    }

    public async getAllTasks(): Promise<IDownloadTask[]> {
        const data = await this.init();
        return [...data.tasks].sort((a, b) => b.createdAt - a.createdAt).map(cloneTask);
    }

    public async getAllDownloaded(): Promise<
        Array<{ platform: string; musicId: string; path: string; quality: IMusic.IQualityKey }>
    > {
        return mediaMetaStore.getAllDownloaded();
    }
}

export const downloadStore = new DownloadStore();
