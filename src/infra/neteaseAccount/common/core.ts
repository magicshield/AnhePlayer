/**
 * 网易云账号业务核心（Electron 主进程与 Tauri 前端共用）
 *
 * 只负责接口编排与数据映射；Cookie 的读取与 HTTP 发送由各运行时的 transport 提供，
 * 登录令牌 MUSIC_U 不经过本模块。
 */
import { buildWeapiBody } from './weapi';
import type {
    INeteaseUserProfile,
    INeteaseMediaSource,
    INeteaseLyricResult,
    INeteaseRadarResult,
} from '@appTypes/infra/neteaseAccount';

export const NETEASE_ORIGIN = 'https://music.163.com';
export const NETEASE_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** 单次请求超时，超时后由调用方回退到插件音源 */
export const NETEASE_REQUEST_TIMEOUT_MS = 8000;

export interface INeteaseSession {
    /** 是否存在 MUSIC_U 登录 Cookie */
    loggedIn: boolean;
    /** __csrf Cookie，weapi 请求体需要 */
    csrf: string;
}

export interface INeteaseTransport {
    getSession(): Promise<INeteaseSession>;
    /**
     * 携带账号 Cookie 请求 music.163.com 并解析 JSON。
     * 非 2xx 或超时必须抛错，供上层区分「网络失败」与「明确未登录」。
     */
    request<T>(method: 'GET' | 'POST', pathWithQuery: string, body?: string): Promise<T>;
}

// 应用音质键与插件约定一致：low=128k、standard=320k、high=无损、super=Hi-Res
const APP_TO_NETEASE_LEVEL: Record<IMusic.IQualityKey, string> = {
    low: 'standard',
    standard: 'exhigh',
    high: 'lossless',
    super: 'hires',
};

const NETEASE_LEVEL_TO_APP: Record<string, IMusic.IQualityKey> = {
    standard: 'low',
    higher: 'low',
    exhigh: 'standard',
    lossless: 'high',
    hires: 'super',
};

const PROFILE_CACHE_TTL = 30_000;
const SONG_DETAIL_BATCH = 500;
const RADAR_BACKFILL_LIMIT = 1000;
const RADAR_PLAYLIST_NAME = '私人雷达';

type RawSong = Record<string, any>;

interface RawPlaylistBrief {
    id?: string | number;
    name?: string;
    copywriter?: string;
    description?: string;
    picUrl?: string;
    coverImgUrl?: string;
}

function normalizeUrl(url?: string): string {
    if (!url) return '';
    return url.startsWith('//') ? `https:${url}` : url;
}

function mapSong(item: RawSong): IMusic.IMusicItem {
    const artists = Array.isArray(item.ar)
        ? item.ar
              .map((a: any) => a.name)
              .filter(Boolean)
              .join(' / ')
        : (item.artists?.map((a: any) => a.name).join(' / ') ?? '未知歌手');

    return {
        id: String(item.id ?? ''),
        platform: 'wy',
        title: item.name ?? '未知歌曲',
        artist: artists || '未知歌手',
        album: item.al?.name ?? item.album?.name ?? '',
        artwork: normalizeUrl(item.al?.picUrl ?? item.album?.picUrl),
        duration: Math.round((item.dt ?? item.duration ?? 0) / 1000),
        reason: item.reason,
    };
}

/** 优先精确匹配「私人雷达」，避免误命中「时光雷达」「新歌雷达」等官方歌单 */
function findRadarPlaylist(list: RawPlaylistBrief[]): RawPlaylistBrief | undefined {
    const named = list.filter((p) => p.id && p.name);
    return (
        named.find((p) => p.name === RADAR_PLAYLIST_NAME) ??
        named.find((p) => p.name!.includes(RADAR_PLAYLIST_NAME))
    );
}

/** 把应用音质键转换为网易云 level；非法输入按标准音质处理 */
export function toNeteaseLevel(quality?: string): string {
    return APP_TO_NETEASE_LEVEL[toAppQuality(quality)];
}

function toAppQuality(quality?: string): IMusic.IQualityKey {
    return Object.prototype.hasOwnProperty.call(APP_TO_NETEASE_LEVEL, quality ?? '')
        ? (quality as IMusic.IQualityKey)
        : 'standard';
}

export function createNeteaseCore(transport: INeteaseTransport) {
    let cachedProfile: INeteaseUserProfile | null = null;
    let lastProfileFetchTime = 0;

    async function weapi<T>(
        path: string,
        data: Record<string, unknown>,
        session?: INeteaseSession,
    ): Promise<T> {
        const { csrf } = session ?? (await transport.getSession());
        const body = await buildWeapiBody({ ...data, csrf_token: csrf });
        return transport.request<T>('POST', path, body);
    }

    async function getProfile(force = false): Promise<INeteaseUserProfile | null> {
        if (!force && cachedProfile && Date.now() - lastProfileFetchTime < PROFILE_CACHE_TTL) {
            return cachedProfile;
        }

        const session = await transport.getSession();
        if (!session.loggedIn) {
            cachedProfile = null;
            return null;
        }

        let result: {
            profile?: {
                userId?: string | number;
                nickname?: string;
                avatarUrl?: string;
                signature?: string;
                vipType?: number;
            } | null;
            account?: { id?: string | number } | null;
        };
        try {
            result = await weapi('/weapi/w/nuser/account/get', {}, session);
        } catch {
            // 网络失败或超时不等于退出登录：保留上次的资料，避免页面闪回登录引导
            return cachedProfile;
        }

        // 接口正常返回但没有用户信息，说明令牌已失效，这才是真正的未登录
        const userId = String(result.profile?.userId ?? result.account?.id ?? '');
        if (!userId) {
            cachedProfile = null;
            return null;
        }

        cachedProfile = {
            userId,
            // 空昵称交给渲染层按当前语言兜底
            nickname: result.profile?.nickname?.trim() ?? '',
            avatarUrl: normalizeUrl(result.profile?.avatarUrl),
            vipType: result.profile?.vipType,
            signature: result.profile?.signature,
            accountHint: `UID: ${userId}`,
        };
        lastProfileFetchTime = Date.now();
        return cachedProfile;
    }

    async function getSongsDetail(ids: string[]): Promise<IMusic.IMusicItem[]> {
        const songs: IMusic.IMusicItem[] = [];
        for (let i = 0; i < ids.length; i += SONG_DETAIL_BATCH) {
            const batch = ids.slice(i, i + SONG_DETAIL_BATCH).map(Number);
            try {
                const result = await weapi<{ code?: number; songs?: RawSong[] }>(
                    '/weapi/v3/song/detail',
                    {
                        c: JSON.stringify(batch.map((id) => ({ id }))),
                        ids: JSON.stringify(batch),
                    },
                );
                if (result.code === 200 && Array.isArray(result.songs)) {
                    songs.push(...result.songs.map(mapSong));
                }
            } catch {
                // 单批失败不影响已取到的结果
            }
        }
        return songs;
    }

    async function getDailyRecommendSongs(): Promise<IMusic.IMusicItem[]> {
        const result = await weapi<{ code?: number; data?: { dailySongs?: RawSong[] } }>(
            '/weapi/v3/discovery/recommend/songs',
            { offset: 0, total: true, limit: 30 },
        );
        if (result.code !== 200 || !result.data?.dailySongs) return [];
        return result.data.dailySongs.map(mapSong);
    }
    async function getPrivateRadarSongs(): Promise<INeteaseRadarResult> {
        let radar: RawPlaylistBrief | undefined;

        // 1. 先在每日推荐歌单里找私人雷达
        try {
            const res = await weapi<{ code?: number; recommend?: RawPlaylistBrief[] }>(
                '/weapi/v1/discovery/recommend/resource',
                {},
            );
            if (res.code === 200 && Array.isArray(res.recommend)) {
                radar = findRadarPlaylist(res.recommend);
            }
        } catch {
            // 推荐歌单失败时继续尝试用户歌单
        }

        // 2. 再在用户自建/收藏歌单里找
        const profile = radar ? null : await getProfile();
        if (!radar && profile?.userId) {
            try {
                const res = await weapi<{ code?: number; playlist?: RawPlaylistBrief[] }>(
                    '/weapi/user/playlist',
                    { uid: profile.userId, offset: 0, limit: 100, includeVideo: false },
                );
                if (res.code === 200 && Array.isArray(res.playlist)) {
                    radar = findRadarPlaylist(res.playlist);
                }
            } catch {
                // 继续向下兜底
            }
        }

        // 3. 拉取雷达歌单详情
        if (radar?.id) {
            const playlistId = String(radar.id);
            const detail = await weapi<{
                code?: number;
                playlist?: RawPlaylistBrief & {
                    tracks?: RawSong[];
                    trackIds?: Array<{ id?: string | number }>;
                };
            }>('/weapi/v6/playlist/detail', { id: playlistId, n: 1000, s: 8 });

            if (detail.code === 200 && detail.playlist) {
                const pl = detail.playlist;
                const songs = (pl.tracks ?? []).map(mapSong);

                // tracks 可能被截断，trackIds 才是完整列表：按 id 补查缺失的歌曲
                const loaded = new Set(songs.map((s) => String(s.id)));
                const allIds = (pl.trackIds ?? []).map((t) => String(t.id ?? '')).filter(Boolean);
                const missing = allIds
                    .filter((id) => !loaded.has(id))
                    .slice(0, Math.max(0, RADAR_BACKFILL_LIMIT - songs.length));
                if (missing.length > 0) {
                    songs.push(...(await getSongsDetail(missing)));
                }

                return {
                    playlistId,
                    title: pl.name || radar.name,
                    description: pl.description || radar.copywriter || radar.description,
                    artwork: normalizeUrl(pl.coverImgUrl || radar.picUrl || radar.coverImgUrl),
                    songs,
                };
            }
        }

        // 兜底：账号没有私人雷达歌单时用每日推荐代替，标题与说明由渲染层按语言显示
        return {
            isFallback: true,
            songs: await getDailyRecommendSongs(),
        };
    }

    async function getMusicUrl(
        songId: string,
        quality?: string,
    ): Promise<INeteaseMediaSource | null> {
        if (!/^\d+$/.test(songId)) return null;
        if (!(await transport.getSession()).loggedIn) return null;

        // 服务端会自动降到账号可用的最高音质（实测非会员请求 lossless/hires 均返回 exhigh），
        // 因此只请求一次，不再逐级重试
        const result = await weapi<{
            code?: number;
            data?: Array<{
                url?: string | null;
                code?: number;
                level?: string;
                freeTrialInfo?: unknown;
            }>;
        }>('/weapi/song/enhance/player/url/v1', {
            ids: JSON.stringify([Number(songId)]),
            level: toNeteaseLevel(quality),
            encodeType: 'flac',
        });

        const item = result.data?.[0];
        if (result.code !== 200 || !item || item.code !== 200 || !item.url) return null;
        // 非会员播放会员歌曲时只返回试听片段，交回插件获取完整音源
        if (item.freeTrialInfo) return null;

        return {
            url: item.url,
            quality: (item.level && NETEASE_LEVEL_TO_APP[item.level]) || toAppQuality(quality),
            headers: { Referer: `${NETEASE_ORIGIN}/`, 'User-Agent': NETEASE_UA },
        };
    }

    async function getLyric(songId: string): Promise<INeteaseLyricResult | null> {
        if (!/^\d+$/.test(songId)) return null;
        try {
            const data = await transport.request<{
                lrc?: { lyric?: string };
                tlyric?: { lyric?: string };
            }>('GET', `/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`);
            return { rawLrc: data.lrc?.lyric, translation: data.tlyric?.lyric };
        } catch {
            return null;
        }
    }

    function clearCache() {
        cachedProfile = null;
        lastProfileFetchTime = 0;
    }

    return {
        getProfile,
        getDailyRecommendSongs,
        getPrivateRadarSongs,
        getMusicUrl,
        getLyric,
        clearCache,
    };
}

export type INeteaseCore = ReturnType<typeof createNeteaseCore>;
