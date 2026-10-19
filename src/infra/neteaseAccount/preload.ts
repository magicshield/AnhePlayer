import { contextBridge, ipcRenderer } from 'electron';
import { IPC, CONTEXT_BRIDGE_KEY } from './common/constant';
import type { INeteaseAccountBridge, INeteaseAccountStatus } from '@appTypes/infra/neteaseAccount';

const mod: INeteaseAccountBridge = {
    getStatus: (force) => ipcRenderer.invoke(IPC.GET_STATUS, force),

    openLogin: () => ipcRenderer.invoke(IPC.OPEN_LOGIN),

    logout: () => ipcRenderer.invoke(IPC.LOGOUT),

    getDailyRecommendSongs: () => ipcRenderer.invoke(IPC.GET_DAILY_RECOMMEND_SONGS),

    getPrivateRadarSongs: () => ipcRenderer.invoke(IPC.GET_PRIVATE_RADAR_SONGS),

    getMusicUrl: (songId, quality) => ipcRenderer.invoke(IPC.GET_MUSIC_URL, { songId, quality }),

    getLyric: (songId) => ipcRenderer.invoke(IPC.GET_LYRIC, songId),

    onStatusChanged: (callback) => {
        const handler = (_event: unknown, status: INeteaseAccountStatus) => {
            callback(status);
        };
        ipcRenderer.on(IPC.STATUS_CHANGED, handler);
        return () => {
            ipcRenderer.removeListener(IPC.STATUS_CHANGED, handler);
        };
    },
};

contextBridge.exposeInMainWorld(CONTEXT_BRIDGE_KEY, mod);
