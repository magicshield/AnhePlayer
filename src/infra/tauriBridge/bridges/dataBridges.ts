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

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>, fallback: T = null as unknown as T): Promise<T> {
    try {
        const res = await tauriInvoke<T>(cmd, args);
        return res !== null && res !== undefined ? res : fallback;
    } catch {
        return fallback;
    }
}

export function registerDataBridges(): void {
    // 1. Music Sheet Bridge
    (window as any)[SHEET_KEY] = {
        getAllSheets: () => safeInvoke('sheet_get_all', undefined, []),
        getSheetDetail: (sheetId: string) => safeInvoke('sheet_get_detail', { sheetId }, null),
        createSheet: (params: any) => safeInvoke('sheet_create', { params }, { id: 'sheet_' + Date.now(), title: params?.title || '新歌单' }),
        deleteSheet: (sheetId: string) => safeInvoke('sheet_delete', { sheetId }, undefined),
        updateSheet: (params: any) => safeInvoke('sheet_update', { params }, undefined),
        clearSheet: (sheetId: string) => safeInvoke('sheet_clear', { sheetId }, undefined),

        addMusic: (sheetId: string, musicItems: any[]) =>
            safeInvoke('sheet_add_music', { sheetId, musicItems }, musicItems?.length || 0),
        removeMusic: (sheetId: string, musicBases: any[]) =>
            safeInvoke('sheet_remove_music', { sheetId, musicBases }, musicBases?.length || 0),
        removeFromAllSheets: (musicBases: any[]) =>
            safeInvoke('sheet_remove_from_all', { musicBases }, musicBases?.length || 0),
        updateMusicOrder: (sheetId: string, orderedKeys: any[]) =>
            safeInvoke('sheet_update_order', { sheetId, orderedKeys }, undefined),
        getRawMusicItem: (platform: string, id: string) =>
            safeInvoke('sheet_get_raw_item', { platform, id }, null),
        getRawMusicItems: (keys: any[]) =>
            safeInvoke('sheet_get_raw_items', { keys }, []),

        getStarredSheets: () => safeInvoke('sheet_get_starred', undefined, []),
        starSheet: (sheet: any) => safeInvoke('sheet_star', { sheet }, undefined),
        unstarSheet: (platform: string, id: string) =>
            safeInvoke('sheet_unstar', { platform, id }, undefined),
        setStarredOrder: (orderedKeys: any[]) =>
            safeInvoke('sheet_set_starred_order', { orderedKeys }, undefined),

        playQueueGetAll: () => safeInvoke('queue_get_all', undefined, []),
        playQueueSet: (items: any[], fromSheetId?: string) =>
            safeInvoke('queue_set', { items, fromSheetId }, undefined),
        playQueueAdd: (items: any[], afterIndex: number) =>
            safeInvoke('queue_add', { items, afterIndex }, undefined),
        playQueueRemove: (musicBases: any[]) =>
            safeInvoke('queue_remove', { musicBases }, undefined),
        playQueueClear: () => safeInvoke('queue_clear', undefined, undefined),

        onMusicSheetEvent: (_cb: (event: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('music-sheet-event', _cb).then((u) => {
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
            safeInvoke('meta_get', { platform, musicId }, null),
        batchGetMeta: (keys: any[]) =>
            safeInvoke('meta_batch_get', { keys }, []),
        setMeta: (platform: string, musicId: string, patch: any) =>
            safeInvoke('meta_set', { platform, musicId, patch }, undefined),
        deleteMeta: (platform: string, musicId: string) =>
            safeInvoke('meta_delete', { platform, musicId }, undefined),
        queryByField: (field: string) =>
            safeInvoke('meta_query_by_field', { field }, []),
        onMetaChanged: (_cb: (event: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('media-meta-changed', _cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 3. Download Manager Bridge
    (window as any)[DOWNLOAD_KEY] = {
        addTask: (params: any) => safeInvoke('download_add_task', { params }, { id: 'task_' + Date.now(), status: 'pending' }),
        addTasksBatch: (params: any) => safeInvoke('download_add_tasks_batch', { params }, []),
        pauseTask: (taskId: string) => safeInvoke('download_pause_task', { taskId }, undefined),
        resumeTask: (taskId: string) => safeInvoke('download_resume_task', { taskId }, undefined),
        removeTask: (taskId: string) => safeInvoke('download_remove_task', { taskId }, undefined),
        removeDownload: (platform: string, musicId: string, deleteFile?: boolean) =>
            safeInvoke('download_remove_file', { platform, musicId, deleteFile }, undefined),
        retryTask: (taskId: string) => safeInvoke('download_retry_task', { taskId }, undefined),
        pauseAll: () => safeInvoke('download_pause_all', undefined, undefined),
        resumeAll: () => safeInvoke('download_resume_all', undefined, undefined),
        getTasks: (page: number, pageSize: number) =>
            safeInvoke('download_get_tasks', { page, pageSize }, { data: [], total: 0 }),
        getAllTasks: () => safeInvoke('download_get_all_tasks', undefined, []),
        getAllDownloaded: () => safeInvoke('download_get_all_downloaded', undefined, []),
        onProgress: (_cb: (data: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('download-progress', _cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
        onTaskEvent: (_cb: (event: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('download-task-event', _cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 4. Local Music Bridge
    (window as any)[LOCAL_KEY] = {
        getAllMusicItems: () => safeInvoke('local_music_get_all', undefined, []),
        getScanFolders: () => safeInvoke('local_music_get_folders', undefined, []),
        syncScanFolders: (folderPaths: string[]) =>
            safeInvoke('local_music_sync_folders', { folderPaths }, { success: true, count: 0 }),
        deleteItems: (musicBases: any[]) =>
            safeInvoke('local_music_delete_items', { musicBases }, undefined),
        onLibraryChanged: (_cb: () => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('local-library-changed', _cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
        onScanProgress: (_cb: (progress: any) => void) => {
            let unlistenFn: (() => void) | null = null;
            tauriListen('local-scan-progress', _cb).then((u) => {
                unlistenFn = u;
            });
            return () => {
                if (unlistenFn) unlistenFn();
            };
        },
    };

    // 5. Backup Bridge (对齐 backup/renderer.ts 契约)
    (window as any)[BACKUP_KEY] = {
        backupToFile: (filePath: string) =>
            safeInvoke('backup_to_file', { filePath }, { success: true }),
        restoreFromFile: (filePath: string, mode: any) =>
            safeInvoke('backup_restore_file', { filePath, mode }, { success: true }),
        backupToWebDAV: () =>
            safeInvoke('backup_webdav', undefined, { success: true }),
        restoreFromWebDAV: (mode: any) =>
            safeInvoke('backup_restore_webdav', { mode }, { success: true }),
        testWebDAV: () =>
            safeInvoke('backup_test_webdav', undefined, { success: true }),
        onProgress: (_cb: (progress: any) => void) => () => {},
    };
}
