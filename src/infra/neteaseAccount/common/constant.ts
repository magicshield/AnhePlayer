export const IPC = {
    GET_STATUS: '@infra/netease-account/get-status',
    OPEN_LOGIN: '@infra/netease-account/open-login',
    LOGOUT: '@infra/netease-account/logout',
    GET_DAILY_RECOMMEND_SONGS: '@infra/netease-account/get-daily-recommend-songs',
    GET_PRIVATE_FM_SONGS: '@infra/netease-account/get-private-fm-songs',
    GET_PRIVATE_RADAR_SONGS: '@infra/netease-account/get-private-radar-songs',
    GET_MUSIC_URL: '@infra/netease-account/get-music-url',
    GET_LYRIC: '@infra/netease-account/get-lyric',
    STATUS_CHANGED: '@infra/netease-account/status-changed',
} as const;

export const CONTEXT_BRIDGE_KEY = '@infra/netease-account';

export const NETEASE_PARTITION = 'persist:anhe-account-netease';
export const NETEASE_LOGIN_URL = 'https://music.163.com/#/login';
export const NETEASE_DOMAINS = ['163.com', '126.com', 'netease.com'];
