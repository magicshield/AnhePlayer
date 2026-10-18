/**
 * Tauri 桥接：数据与持久化业务模块
 * 覆盖：musicSheet / mediaMeta / downloadManager / localMusic / backup
 */
import { CONTEXT_BRIDGE_KEY as SHEET_KEY } from '@infra/musicSheet/common/constant';
import { CONTEXT_BRIDGE_KEY as META_KEY } from '@infra/mediaMeta/common/constant';
import { CONTEXT_BRIDGE_KEY as DOWNLOAD_KEY } from '@infra/downloadManager/common/constant';
import { CONTEXT_BRIDGE_KEY as LOCAL_KEY } from '@infra/localMusic/common/constant';
import { CONTEXT_BRIDGE_KEY as BACKUP_KEY } from '@infra/backup/common/constant';
import { tauriInvoke, tauriListen } from '../ipc';

export function registerDataBridges(): void {
    // 1. Music Sheet Bridge
    (window as any)[SHEET_KEY] = {
        getAllSheets: () => tauriInvoke('sheet_get_all'),
        getSheetDetail: (sheetId: string) => tauriInvoke('sheet_get_detail', { sheetId }),
        createSheet: (params: any) => tauriInvoke('sheet_create', { params }),
        deleteSheet: (sheetId: string) => tauriInvoke('sheet_delete', { sheetId }),
        updateSheet: (params: any) => tauriInvoke('sheet_update', { params }),
        clearSheet: (sheetId: string) => tauriInvoke('sheet_clear', { sheetId }),

        addMusic: (sheetId: string, musicItems: any[]) =>
            tauriInvoke('sheet_add_music', { sheetId, musicItems }),
        removeMusic: (sheetId: string, musicBases: any[]) =>
            tauriInvoke('sheet_remove_music', { sheetId, musicBases }),
        removeFromAllSheets: (musicBases: any[]) =>
            tauriInvoke('sheet_remove_from_all', { musicBases }),
        updateMusicOrder: (sheetId: string, orderedKeys: any[]) =>
            tauriInvoke('sheet_update_order', { sheetId, orderedKeys }),
        getRawMusicItem: (platform: string, id: string) =>
            tauriInvoke('sheet_get_raw_item', { platform, id }),
        getRawMusicItems: (keys: any[]) =>
            tauriInvoke('sheet_get_raw_items', { keys }),

        getStarredSheets: () => tauriInvoke('sheet_get_starred'),
        starSheet: (sheet: any) => tauriInvoke('sheet_star', { sheet }),
        unstarSheet: (platform: string, id: string) =>
            tauriInvoke('sheet_unstar', { platform, id }),
        setStarredOrder: (orderedKeys: any[]) =>
            tauriInvoke('sheet_set_starred_order', { orderedKeys }),

        playQueueGetAll: () => tauriInvoke('queue_get_all'),
        playQueueSet: (items: any[], fromSheetId?: string) =>
            tauriInvoke('queue_set', { items, fromSheetId }),
        playQueueAdd: (items: any[], afterIndex: number) =>
            tauriInvoke('queue_add', { items, afterIndex }),
        playQueueRemove: (musicBases: any[]) =>
            tauriInvoke('queue_remove', { musicBases }),
        playQueueClear: () => tauriInvoke('queue_clear'),

        onMusicSheetEvent: (cb: (event: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('music-sheet-event', cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 2. Media Meta Bridge
    (window as any)[META_KEY] = {
        getMeta: (platform: string, musicId: string) =>
            tauriInvoke('meta_get', { platform, musicId }),
        batchGetMeta: (keys: any[]) =>
            tauriInvoke('meta_batch_get', { keys }),
        setMeta: (platform: string, musicId: string, patch: any) =>
            tauriInvoke('meta_set', { platform, musicId, patch }),
        deleteMeta: (platform: string, musicId: string) =>
            tauriInvoke('meta_delete', { platform, musicId }),
        queryByField: (field: string) =>
            tauriInvoke('meta_query_by_field', { field }),
        onMetaChanged: (cb: (event: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('media-meta-changed', cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 3. Download Manager Bridge
    (window as any)[DOWNLOAD_KEY] = {
        addTask: (params: any) => tauriInvoke('download_add_task', { params }),
        addTasksBatch: (params: any) => tauriInvoke('download_add_tasks_batch', { params }),
        pauseTask: (taskId: string) => tauriInvoke('download_pause_task', { taskId }),
        resumeTask: (taskId: string) => tauriInvoke('download_resume_task', { taskId }),
        removeTask: (taskId: string) => tauriInvoke('download_remove_task', { taskId }),
        removeDownload: (platform: string, musicId: string, deleteFile?: boolean) =>
            tauriInvoke('download_remove_file', { platform, musicId, deleteFile }),
        retryTask: (taskId: string) => tauriInvoke('download_retry_task', { taskId }),
        pauseAll: () => tauriInvoke('download_pause_all'),
        resumeAll: () => tauriInvoke('download_resume_all'),
        getTasks: (page: number, pageSize: number) =>
            tauriInvoke('download_get_tasks', { page, pageSize }),
        getAllTasks: () => tauriInvoke('download_get_all_tasks'),
        getAllDownloaded: () => tauriInvoke('download_get_all_downloaded'),
        onProgress: (cb: (data: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('download-progress', cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
        onTaskEvent: (cb: (event: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('download-task-event', cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 4. Local Music Bridge
    (window as any)[LOCAL_KEY] = {
        getAllMusicItems: () => tauriInvoke('local_music_get_all'),
        getScanFolders: () => tauriInvoke('local_music_get_folders'),
        syncScanFolders: (folderPaths: string[]) =>
            tauriInvoke('local_music_sync_folders', { folderPaths }),
        deleteItems: (musicBases: any[]) =>
            tauriInvoke('local_music_delete_items', { musicBases }),
        onLibraryChanged: (cb: () => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('local-library-changed', cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
        onScanProgress: (cb: (progress: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('local-scan-progress', cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 5. Backup Bridge
    (window as any)[BACKUP_KEY] = {
        exportBackup: (filePath: string) => tauriInvoke('backup_export', { filePath }),
        importBackup: (filePath: string) => tauriInvoke('backup_import', { filePath }),
    };
}
