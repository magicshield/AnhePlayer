/**
 * Tauri 桥接：数据与持久化业务模块
 * 覆盖：musicSheet / mediaMeta / downloadManager / localMusic / backup
 *
 * 架构说明：Tauri 版为纯 JS 实现（数据落盘于 <userData>/anhe-player-data/*.json），
 * 行为语义使用内存 + JSON 持久化。
 * 事件（music-sheet-event / media-meta-changed / download 进度与任务事件 /
 * localMusic 进度与库变更 / backup 进度）均通过本地监听器回调传递，
 * 因为所有消费方与桥同处一个渲染进程上下文。
 */
import { CONTEXT_BRIDGE_KEY as SHEET_KEY } from '@infra/musicSheet/common/constant';
import { CONTEXT_BRIDGE_KEY as META_KEY } from '@infra/mediaMeta/common/constant';
import { CONTEXT_BRIDGE_KEY as DOWNLOAD_KEY } from '@infra/downloadManager/common/constant';
import { CONTEXT_BRIDGE_KEY as LOCAL_KEY } from '@infra/localMusic/common/constant';
import { CONTEXT_BRIDGE_KEY as BACKUP_KEY } from '@infra/backup/common/constant';
import { backupStore } from './data/backupStore';
import { downloadStore } from './data/downloadStore';
import { localMusicStore } from './data/localMusicStore';
import { mediaMetaStore } from './data/mediaMetaStore';
import { musicSheetStore } from './data/musicSheetStore';

export function registerDataBridges(): void {
    // 1. Music Sheet Bridge
    (window as any)[SHEET_KEY] = {
        getAllSheets: () => musicSheetStore.getAllSheets(),
        getSheetDetail: (sheetId: string) => musicSheetStore.getSheetDetail(sheetId),
        createSheet: (params: any) => musicSheetStore.createSheet(params),
        deleteSheet: (sheetId: string) => musicSheetStore.deleteSheet(sheetId),
        updateSheet: (params: any) => musicSheetStore.updateSheet(params),
        clearSheet: (sheetId: string) => musicSheetStore.clearSheet(sheetId),

        addMusic: (sheetId: string, musicItems: any[]) =>
            musicSheetStore.addMusic(sheetId, musicItems),
        removeMusic: (sheetId: string, musicBases: any[]) =>
            musicSheetStore.removeMusic(sheetId, musicBases),
        removeFromAllSheets: (musicBases: any[]) => musicSheetStore.removeFromAllSheets(musicBases),
        updateMusicOrder: (sheetId: string, orderedKeys: any[]) =>
            musicSheetStore.updateMusicOrder(sheetId, orderedKeys),
        getRawMusicItem: (platform: string, id: string) =>
            musicSheetStore.getRawMusicItem(platform, id),
        getRawMusicItems: (keys: any[]) => musicSheetStore.getRawMusicItems(keys),

        getStarredSheets: () => musicSheetStore.getStarredSheets(),
        starSheet: (sheet: any) => musicSheetStore.starSheet(sheet),
        unstarSheet: (platform: string, id: string) => musicSheetStore.unstarSheet(platform, id),
        setStarredOrder: (orderedKeys: any[]) => musicSheetStore.setStarredOrder(orderedKeys),

        playQueueGetAll: () => musicSheetStore.playQueueGetAll(),
        playQueueSet: (items: any[], fromSheetId?: string) =>
            musicSheetStore.playQueueSet(items, fromSheetId),
        playQueueAdd: (items: any[], afterIndex: number) =>
            musicSheetStore.playQueueAdd(items, afterIndex),
        playQueueRemove: (musicBases: any[]) => musicSheetStore.playQueueRemove(musicBases),
        playQueueClear: () => musicSheetStore.playQueueClear(),

        onMusicSheetEvent: (cb: (event: any) => void) => musicSheetStore.onMusicSheetEvent(cb),
    };

    // 2. Media Meta Bridge
    (window as any)[META_KEY] = {
        getMeta: (platform: string, musicId: string) => mediaMetaStore.getMeta(platform, musicId),
        batchGetMeta: (keys: any[]) => mediaMetaStore.batchGetMeta(keys),
        setMeta: (platform: string, musicId: string, patch: any) =>
            mediaMetaStore.setMeta(platform, musicId, patch),
        deleteMeta: (platform: string, musicId: string) =>
            mediaMetaStore.deleteMeta(platform, musicId),
        queryByField: (field: string) => mediaMetaStore.queryByField(field),
        onMetaChanged: (cb: (event: any) => void) => mediaMetaStore.onMetaChanged(cb),
    };

    // 3. Download Manager Bridge
    (window as any)[DOWNLOAD_KEY] = {
        addTask: (params: any) => downloadStore.addTask(params),
        addTasksBatch: (params: any) => downloadStore.addTasksBatch(params),
        pauseTask: (taskId: string) => downloadStore.pauseTask(taskId),
        resumeTask: (taskId: string) => downloadStore.resumeTask(taskId),
        removeTask: (taskId: string) => downloadStore.removeTask(taskId),
        removeDownload: (platform: string, musicId: string, deleteFile?: boolean) =>
            downloadStore.removeDownload(platform, musicId, deleteFile),
        retryTask: (taskId: string) => downloadStore.retryTask(taskId),
        pauseAll: () => downloadStore.pauseAll(),
        resumeAll: () => downloadStore.resumeAll(),
        getTasks: (page: number, pageSize: number) => downloadStore.getTasks(page, pageSize),
        getAllTasks: () => downloadStore.getAllTasks(),
        getAllDownloaded: () => downloadStore.getAllDownloaded(),
        onProgress: (cb: (data: any) => void) => downloadStore.onProgress(cb),
        onTaskEvent: (cb: (event: any) => void) => downloadStore.onTaskEvent(cb),
    };

    // 4. Local Music Bridge
    (window as any)[LOCAL_KEY] = {
        getAllMusicItems: () => localMusicStore.getAllMusicItems(),
        getScanFolders: () => localMusicStore.getScanFolders(),
        syncScanFolders: (folderPaths: string[]) => localMusicStore.syncScanFolders(folderPaths),
        deleteItems: (musicBases: any[]) => localMusicStore.deleteItems(musicBases),
        onLibraryChanged: (cb: () => void) => localMusicStore.onLibraryChanged(cb),
        onScanProgress: (cb: (progress: any) => void) => localMusicStore.onScanProgress(cb),
    };

    // 5. Backup Bridge
    (window as any)[BACKUP_KEY] = {
        backupToFile: (filePath: string) => backupStore.backupToFile(filePath),
        restoreFromFile: (filePath: string, mode: any) =>
            backupStore.restoreFromFile(filePath, mode),
        backupToWebDAV: () => backupStore.backupToWebDAV(),
        restoreFromWebDAV: (mode: any) => backupStore.restoreFromWebDAV(mode),
        testWebDAV: () => backupStore.testWebDAV(),
        onProgress: (cb: (progress: any) => void) => backupStore.onProgress(cb),
    };
}
