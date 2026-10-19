import { ipcMain, BrowserWindow } from 'electron';
import type { IWindowManager } from '@appTypes/main/windowManager';
import { IPC } from '../common/constant';
import { neteaseCore, getNeteaseAccountStatus, logoutNetease } from './api';
import { openNeteaseLoginWindow } from './loginWindow';

class NeteaseAccount {
    private isSetup = false;
    private windowManager: IWindowManager | null = null;

    public setup({ windowManager }: { windowManager: IWindowManager }) {
        if (this.isSetup) return;
        this.windowManager = windowManager;

        this.registerIpcHandlers();
        this.isSetup = true;
    }

    private notifyStatusChanged() {
        void getNeteaseAccountStatus(true).then((status) => {
            this.windowManager?.broadcast(IPC.STATUS_CHANGED, status);
        });
    }

    private registerIpcHandlers() {
        ipcMain.handle(IPC.GET_STATUS, async (_event, force?: boolean) => {
            return getNeteaseAccountStatus(force);
        });

        ipcMain.handle(IPC.OPEN_LOGIN, async () => {
            const mainWindow =
                this.windowManager?.__getWindowUnsafe('main') ??
                BrowserWindow.getFocusedWindow() ??
                undefined;
            const status = await openNeteaseLoginWindow(async () => {
                const profile = await neteaseCore.getProfile(true);
                return Boolean(profile?.userId);
            }, mainWindow);

            if (status === 'connected') {
                this.notifyStatusChanged();
            }
            return status;
        });

        ipcMain.handle(IPC.LOGOUT, async () => {
            await logoutNetease();
            this.notifyStatusChanged();
            return true;
        });

        ipcMain.handle(IPC.GET_DAILY_RECOMMEND_SONGS, async () => {
            return neteaseCore.getDailyRecommendSongs();
        });

        ipcMain.handle(IPC.GET_PRIVATE_FM_SONGS, async () => {
            return neteaseCore.getPrivateFmSongs();
        });

        ipcMain.handle(IPC.GET_PRIVATE_RADAR_SONGS, async () => {
            return neteaseCore.getPrivateRadarSongs();
        });

        ipcMain.handle(
            IPC.GET_MUSIC_URL,
            async (_event, { songId, quality }: { songId: string; quality?: string }) => {
                return neteaseCore.getMusicUrl(songId, quality);
            },
        );

        ipcMain.handle(IPC.GET_LYRIC, async (_event, songId: string) => {
            return neteaseCore.getLyric(songId);
        });
    }
}

const neteaseAccount = new NeteaseAccount();
export default neteaseAccount;
