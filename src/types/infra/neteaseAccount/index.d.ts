export interface INeteaseUserProfile {
    userId: string;
    /** 可能为空，由渲染层按当前语言兜底 */
    nickname: string;
    avatarUrl: string;
    vipType?: number;
    signature?: string;
    accountHint?: string;
}

export interface INeteaseAccountStatus {
    connected: boolean;
    profile: INeteaseUserProfile | null;
}

export interface INeteaseMediaSource {
    url: string;
    /** 已换算为应用音质键 */
    quality: IMusic.IQualityKey;
    headers?: Record<string, string>;
}

export interface INeteaseLyricResult {
    rawLrc?: string;
    translation?: string;
}

export interface INeteaseRadarResult {
    playlistId?: string;
    title?: string;
    description?: string;
    artwork?: string;
    /** 未找到私人雷达歌单，songs 为每日推荐 */
    isFallback?: boolean;
    songs: IMusic.IMusicItem[];
}

/** 网易云账号渲染层接口 */
export interface INeteaseAccountBridge {
    getStatus(force?: boolean): Promise<INeteaseAccountStatus>;
    openLogin(): Promise<'connected' | 'cancelled'>;
    logout(): Promise<boolean>;
    getDailyRecommendSongs(): Promise<IMusic.IMusicItem[]>;
    getPrivateFmSongs(): Promise<IMusic.IMusicItem[]>;
    getPrivateRadarSongs(): Promise<INeteaseRadarResult>;
    getMusicUrl(songId: string, quality?: IMusic.IQualityKey): Promise<INeteaseMediaSource | null>;
    getLyric(songId: string): Promise<INeteaseLyricResult | null>;
    onStatusChanged(callback: (status: INeteaseAccountStatus) => void): () => void;
}
