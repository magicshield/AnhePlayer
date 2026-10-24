/** contextBridge key */
export const CONTEXT_BRIDGE_KEY = '@infra/music-sheet';

/** 每歌单最大歌曲数 */
export const MAX_MUSIC_PER_SHEET = 100_000;

/** 播放队列最大长度 */
export const MAX_QUEUE_SIZE = 100_000;

/** 默认收藏歌单 ID（固定，不可删除） */
export const DEFAULT_FAVORITE_SHEET_ID = 'favorite';

/** 播放队列虚拟歌单 ID */
export const PLAY_QUEUE_SHEET_ID = '__play_queue__';

/** 已下载歌单 ID（系统歌单，不可删除） */
export const DOWNLOADED_SHEET_ID = '__downloaded__';

/** 电台收藏系统歌单 ID（隐藏，不与歌曲「我喜欢」混用） */
export const RADIO_FAVORITE_SHEET_ID = '__radio_favorite__';

/**
 * musicSheet 模块广播事件的 payload。
 *
 * @property origin 事件来源：
 *   - 'user'：renderer 用户操作通过 bridge 触发，renderer 已通过乐观更新处理了 musicList，
 *              只需刷新 sheetsAtom（歌单元数据如 worksNum）。
 *   - 'internal'：bridge 服务内部模块（如 downloadManager）通过 DI 触发，
 *              renderer 无感知，需要同时刷新 sheetsAtom 和 musicListAtom。
 * @property sheetId 受影响的歌单 ID，不传表示影响所有歌单。
 */
export interface IMusicSheetEvent {
    origin: 'user' | 'internal';
    sheetId?: string;
}
