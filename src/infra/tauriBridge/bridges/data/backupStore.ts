/**
 * data 层：backup 的 Tauri/JS 实现
 *
 * - 文件备份/恢复：直接读写 JSON（IBackupData v1，兼容旧版无 version 格式）
 * - WebDAV 备份/恢复/测试：Rust webdav_* 命令（basic auth + MKCOL/PUT/GET/PROPFIND）
 * - 进度事件：本地监听器广播（按歌单粒度）
 */
import { WEBDAV_BACKUP_PATH } from '@infra/backup/common/constant';
import { CONTEXT_BRIDGE_KEY as APP_CONFIG_KEY } from '@infra/appConfig/common/constant';
import type {
    IBackupData,
    IBackupProgress,
    IBackupResult,
    IBackupSheet,
    RestoreMode,
} from '@appTypes/infra/backup';
import type { IAppConfig } from '@appTypes/infra/appConfig';
import { musicSheetStore } from './musicSheetStore';
import { readTextFile, writeTextFile } from './tauriFs';
import { tauriInvoke } from '../../ipc';

type BackupProgressListener = (progress: IBackupProgress) => void;

/** 解析备份数据（兼容旧版无 version 字段的格式） */
function parseBackupData(raw: string): IBackupData {
    const data = JSON.parse(raw);

    if (!data.version && Array.isArray(data.musicSheets)) {
        return {
            version: 1,
            createdAt: Date.now(),
            musicSheets: data.musicSheets,
        };
    }

    if (data.version === 1) {
        return data as IBackupData;
    }

    throw new Error('不支持的备份文件格式');
}

class BackupStore {
    private config: IAppConfig = {};
    private progressListeners = new Set<BackupProgressListener>();

    public onProgress(cb: BackupProgressListener): () => void {
        this.progressListeners.add(cb);
        return () => {
            this.progressListeners.delete(cb);
        };
    }

    private sendProgress(progress: IBackupProgress): void {
        for (const listener of [...this.progressListeners]) {
            try {
                listener(progress);
            } catch (e) {
                console.error('[backup] progress listener error:', e);
            }
        }
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

    /** 组装备份数据（导出全部非 system 歌单的全量 raw） */
    private async buildBackupData(): Promise<IBackupData> {
        const sheets = await musicSheetStore.getExportableSheets();
        const musicSheets: IBackupSheet[] = [];
        for (const sheet of sheets) {
            musicSheets.push({
                id: sheet.id,
                title: sheet.title,
                musicList: await musicSheetStore.getSheetMusicRaw(sheet.id),
            });
        }
        return {
            version: 1,
            createdAt: Date.now(),
            musicSheets,
        };
    }

    private async importWithProgress(data: IBackupData, mode: RestoreMode): Promise<IBackupResult> {
        const importResult = await musicSheetStore.importSheets(
            data.musicSheets,
            mode,
            (current, total, sheetTitle) => {
                this.sendProgress({ current, total, sheetTitle });
            },
        );
        return {
            success: true,
            sheetsCount: importResult.sheetsCount,
            songsCount: importResult.songsCount,
        };
    }

    // ─── IPC 契约方法 ───

    public async backupToFile(filePath: string): Promise<IBackupResult> {
        try {
            const data = await this.buildBackupData();
            const ok = await writeTextFile(filePath, JSON.stringify(data));
            if (!ok) {
                return { success: false, error: '写入备份文件失败' };
            }
            const songsCount = data.musicSheets.reduce((sum, s) => sum + s.musicList.length, 0);
            return {
                success: true,
                sheetsCount: data.musicSheets.length,
                songsCount,
            };
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    public async restoreFromFile(filePath: string, mode: RestoreMode): Promise<IBackupResult> {
        try {
            const raw = await readTextFile(filePath);
            if (raw == null) {
                return { success: false, error: '读取备份文件失败' };
            }
            const data = parseBackupData(raw);
            return await this.importWithProgress(data, mode);
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    public async backupToWebDAV(): Promise<IBackupResult> {
        try {
            await this.refreshConfig();
            const url = this.config['backup.webdav.url'];
            const username = this.config['backup.webdav.username'];
            const password = this.config['backup.webdav.password'];
            if (!url || !username || !password) {
                return { success: false, error: 'webdav_data_not_complete' };
            }

            const data = await this.buildBackupData();
            const json = JSON.stringify(data);
            await tauriInvoke('webdav_put', {
                url,
                username,
                password,
                path: WEBDAV_BACKUP_PATH,
                content: json,
            });

            const songsCount = data.musicSheets.reduce((sum, s) => sum + s.musicList.length, 0);
            return {
                success: true,
                sheetsCount: data.musicSheets.length,
                songsCount,
            };
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    public async restoreFromWebDAV(mode: RestoreMode): Promise<IBackupResult> {
        try {
            await this.refreshConfig();
            const url = this.config['backup.webdav.url'];
            const username = this.config['backup.webdav.username'];
            const password = this.config['backup.webdav.password'];
            if (!url || !username || !password) {
                return { success: false, error: 'webdav_data_not_complete' };
            }

            const raw = await tauriInvoke<string | null>('webdav_get', {
                url,
                username,
                password,
                path: WEBDAV_BACKUP_PATH,
            });
            if (raw == null) {
                return { success: false, error: 'webdav_backup_file_not_exist' };
            }

            const data = parseBackupData(raw);
            return await this.importWithProgress(data, mode);
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    public async testWebDAV(): Promise<IBackupResult> {
        try {
            await this.refreshConfig();
            const url = this.config['backup.webdav.url'];
            const username = this.config['backup.webdav.username'];
            const password = this.config['backup.webdav.password'];
            if (!url || !username || !password) {
                return { success: false, error: 'webdav_data_not_complete' };
            }

            const ok = await tauriInvoke<boolean>('webdav_test', { url, username, password });
            if (ok) return { success: true };
            return { success: false, error: 'WebDAV 连接失败' };
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
}

export const backupStore = new BackupStore();
