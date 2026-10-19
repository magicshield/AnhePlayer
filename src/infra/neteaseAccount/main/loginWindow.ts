import { BrowserWindow, screen, shell, session, type Session, type WebContents } from 'electron';
import { NETEASE_PARTITION, NETEASE_LOGIN_URL, NETEASE_DOMAINS } from '../common/constant';

let loginWindow: BrowserWindow | null = null;
let loginPromise: Promise<'connected' | 'cancelled'> | null = null;

const ALLOWED_DOMAINS = [
    ...NETEASE_DOMAINS,
    'qq.com',
    'weixin.qq.com',
    'weibo.com',
    'sina.com.cn',
    'apple.com',
];

function isAllowedHost(targetUrl: string): boolean {
    try {
        const parsed = new URL(targetUrl);
        return ALLOWED_DOMAINS.some(
            (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
        );
    } catch {
        return false;
    }
}

/** 远程页面给出的链接只允许 http/https 交给系统打开，防止唤起任意协议处理程序 */
function openExternalSafely(targetUrl: string) {
    try {
        const { protocol } = new URL(targetUrl);
        if (protocol === 'http:' || protocol === 'https:') {
            void shell.openExternal(targetUrl);
        }
    } catch {
        // 非法 URL 直接丢弃
    }
}

function getLoginBounds(parent?: BrowserWindow) {
    const { workArea } = parent
        ? screen.getDisplayMatching(parent.getBounds())
        : screen.getPrimaryDisplay();
    const width = Math.max(320, Math.min(1100, workArea.width - 48));
    const height = Math.max(320, Math.min(800, workArea.height - 64));
    return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height,
        minWidth: Math.min(560, width),
        minHeight: Math.min(460, height),
        resizable: true,
    };
}

function getLoginZoom(url: string, width: number, height: number): number {
    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        return 1;
    }
    const targetSize =
        host === 'music.163.com'
            ? [1100, 760]
            : host === 'graph.qq.com' || host.endsWith('.ptlogin2.qq.com')
              ? [720, 540]
              : host === 'open.weixin.qq.com'
                ? [420, 560]
                : null;
    return targetSize
        ? Math.max(0.3, Math.min(1, width / targetSize[0], height / targetSize[1]))
        : 1;
}

function fitLoginWindow(win: BrowserWindow, initialUrl: string) {
    const fit = () => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        const [width, height] = win.getContentSize();
        win.webContents.setZoomFactor(
            getLoginZoom(win.webContents.getURL() || initialUrl, width, height),
        );
    };
    win.on('resize', fit);
    win.webContents.on('dom-ready', fit);
    win.webContents.on('did-navigate', fit);
    fit();
}

function configureLoginContents(
    contents: WebContents,
    accountSession: Session,
    onChildWindow?: (w: BrowserWindow) => void,
) {
    // 移除 Electron 标识以保证官方页面正常渲染
    const ua = contents
        .getUserAgent()
        .replace(/\sElectron\/[^\s]+/i, '')
        .replace(/\sanhe-player\/[^\s]+/i, '');
    contents.setUserAgent(ua);

    contents.setWindowOpenHandler(({ url }) => {
        if (!isAllowedHost(url)) {
            openExternalSafely(url);
            return { action: 'deny' };
        }
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                ...getLoginBounds(BrowserWindow.fromWebContents(contents) ?? undefined),
                show: true,
                autoHideMenuBar: true,
                backgroundColor: '#ffffff',
                webPreferences: {
                    session: accountSession,
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    spellcheck: false,
                },
            },
        };
    });

    contents.on('will-navigate', (event, url) => {
        if (isAllowedHost(url)) return;
        event.preventDefault();
        openExternalSafely(url);
    });

    contents.on('did-create-window', (childWin) => {
        childWin.setMenuBarVisibility(false);
        fitLoginWindow(childWin, 'https://music.163.com/');
        onChildWindow?.(childWin);
        configureLoginContents(childWin.webContents, accountSession, onChildWindow);
    });
}

export function openNeteaseLoginWindow(
    verifyLogin: () => Promise<boolean>,
    parent?: BrowserWindow,
): Promise<'connected' | 'cancelled'> {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.show();
        loginWindow.focus();
        return loginPromise ?? Promise.resolve('cancelled');
    }

    const accountSession = session.fromPartition(NETEASE_PARTITION);
    const win = new BrowserWindow({
        ...getLoginBounds(parent),
        parent,
        modal: !!parent,
        show: false,
        autoHideMenuBar: true,
        title: '网易云音乐账号登录',
        backgroundColor: '#ffffff',
        webPreferences: {
            session: accountSession,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            spellcheck: false,
        },
    });

    loginWindow = win;

    let resolveTask: (status: 'connected' | 'cancelled') => void;
    loginPromise = new Promise<'connected' | 'cancelled'>((resolve) => {
        resolveTask = resolve;
    });

    let settled = false;
    let checking = false;
    const children = new Set<BrowserWindow>();

    const finish = (status: 'connected' | 'cancelled') => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        accountSession.cookies.off('changed', check);
        loginWindow = null;
        loginPromise = null;
        resolveTask(status);
        for (const child of children) {
            if (!child.isDestroyed()) child.close();
        }
        if (!win.isDestroyed()) win.close();
    };

    const check = () => {
        if (settled || checking) return;
        checking = true;
        void verifyLogin()
            .then((connected) => {
                if (!settled && connected) finish('connected');
            })
            .catch(() => {})
            .finally(() => {
                checking = false;
            });
    };

    const timer = setInterval(check, 1500);
    accountSession.cookies.on('changed', check);

    configureLoginContents(win.webContents, accountSession, (child) => {
        children.add(child);
        child.once('closed', () => {
            children.delete(child);
        });
    });

    fitLoginWindow(win, NETEASE_LOGIN_URL);

    win.once('closed', () => {
        finish('cancelled');
    });

    win.once('ready-to-show', () => {
        if (!settled) {
            win.show();
            win.focus();
        }
    });

    void win.loadURL(NETEASE_LOGIN_URL).catch(() => {});

    return loginPromise;
}
