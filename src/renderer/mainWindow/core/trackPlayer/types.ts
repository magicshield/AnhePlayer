/**
 * TrackPlayer 模块内部类型
 */
import type LyricParser from '@common/lyricParser';
import type { IParsedLrcItem } from '@common/lyricParser';

export interface ICurrentLyric {
    parser?: LyricParser;
    currentLrc?: IParsedLrcItem;
}

export interface IPlayOptions {
    restartOnSameMedia?: boolean;
}

/** 播放器内部解析后的音源，补充插件协议不表达的传输信息。 */
export interface IResolvedMediaSource extends IPlugin.IMediaSourceResult {
    isHls?: boolean;
    publicOnly?: boolean;
}
