/**
 * Tauri 桥接：pluginManager — getLyric 适配器（渲染进程版）
 *
 * 由 src/infra/pluginManager/main/getLyricAdapter.ts 移植：
 * - fs（本地 .lrc 读取）→ Tauri fs_is_file / fs_read_file 命令
 * - axios（lrcUrl 抓取）→ Tauri http_request（带原生 fetch 回退）
 * - path 操作 → 轻量字符串工具（Windows 路径语义）
 *
 * 多步获取顺序与原版保持一致：
 * 0. mediaMeta.associatedLyric → 1. rawLrc → 2. 本地同名 .lrc/-tr
 * 3. 插件 getLyric → 4. lrcUrl 抓取 → 5. 自动匹配搜索
 */
import { isSameMedia } from '@common/mediaKey';
import type { IMediaMeta } from '@appTypes/infra/mediaMeta';
import { tauriInvoke } from '../../ipc';

/** getLyric 适配器所需的参数 */
export interface IGetLyricParams {
    musicItem: IMusic.IMusicItem;
}

/** 调用插件方法的函数类型 */
type CallPluginMethodFn = (params: {
    hash?: string;
    platform?: string;
    method: string;
    args: any[];
}) => Promise<any>;

/** mediaMeta 依赖（异步包装，兼容同步/异步实现） */
export interface ILyricMediaMetaProvider {
    getDownloadData(
        platform: string,
        musicId: string,
    ): Promise<IMediaMeta['downloadData'] | null> | IMediaMeta['downloadData'] | null;
    getAssociatedLyric(
        platform: string,
        musicId: string,
    ): Promise<IMediaMeta['associatedLyric'] | null> | IMediaMeta['associatedLyric'] | null;
    setMeta(platform: string, musicId: string, patch: { associatedLyric?: IMediaMeta['associatedLyric'] }): Promise<void> | void;
}

/** 曲库查询依赖：从 musicSheet 取 raw JSON 补充 localPath */
export interface ILyricMusicItemProvider {
    getRawMusicItem(
        platform: string,
        musicId: string,
    ): Promise<{ localPath?: string } | null> | { localPath?: string } | null;
}

/** getLyric 适配器的全部依赖 */
export interface IGetLyricAdapterDeps {
    callPluginMethod: CallPluginMethodFn;
    mediaMeta: ILyricMediaMetaProvider;
    musicItemProvider: ILyricMusicItemProvider;
    /** 返回支持 lyric 搜索且已启用的插件平台名列表 */
    listLyricSearchPlugins?: () => Array<{ platform: string }>;
    /** 是否启用自动匹配（lyric.autoMatch 配置） */
    isAutoMatchEnabled?: () => boolean | Promise<boolean>;
}

// ─── fs / http 工具 ───

async function isFile(filePath: string): Promise<boolean> {
    try {
        return !!(await tauriInvoke<boolean>('fs_is_file', { path: filePath }));
    } catch {
        return false;
    }
}

async function readTextFile(filePath: string): Promise<string | null> {
    try {
        const content = await tauriInvoke<string | number[] | null>('fs_read_file', {
            path: filePath,
            encoding: 'utf-8',
        });
        return typeof content === 'string' ? content : null;
    } catch {
        return null;
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

/** 抓取文本（优先 Tauri http_request，回退原生 fetch） */
async function fetchText(url: string, timeoutMs = 5000): Promise<string | null> {
    const viaInvoke = async () => {
        const resp = await tauriInvoke<{ statusCode: number; body: string } | null>(
            'http_request',
            { url, options: { method: 'GET' } },
        );
        if (resp && typeof resp.body === 'string') return resp.body;
        throw new Error('Invalid http_request response');
    };
    const viaFetch = async () => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.text();
    };

    try {
        return await withTimeout(viaInvoke(), timeoutMs);
    } catch {
        try {
            return await withTimeout(viaFetch(), timeoutMs);
        } catch {
            return null;
        }
    }
}

// ─── 路径工具（Windows 语义） ───

/** 拆分路径为目录前缀与文件名 */
function splitPath(p: string): { dir: string; base: string } {
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return i >= 0 ? { dir: p.slice(0, i + 1), base: p.slice(i + 1) } : { dir: '', base: p };
}

/** 去掉最后一个扩展名（path.parse(x).name 等价物） */
function stripExt(name: string): string {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
}

/**
 * 获取歌曲的本地文件路径。
 *
 * 依次尝试：
 * 1. mediaMeta 中的 downloadData.path（已下载歌曲）
 * 2. musicItem.localPath（本地扫描歌曲，完整对象时可用）
 * 3. 从 musicSheet DB 查 raw JSON 取 localPath（slim fallback）
 */
async function getLocalPath(
    musicItem: IMusic.IMusicItem,
    mediaMeta: ILyricMediaMetaProvider,
    musicItemProvider: ILyricMusicItemProvider,
): Promise<string | null> {
    const downloadData = await mediaMeta.getDownloadData(musicItem.platform, String(musicItem.id));
    if (downloadData?.path) return downloadData.path;

    if (musicItem.localPath) return musicItem.localPath;

    const rawItem = await musicItemProvider.getRawMusicItem(
        musicItem.platform,
        String(musicItem.id),
    );
    if (rawItem?.localPath) return rawItem.localPath;

    return null;
}

/**
 * getLyric 适配器（Tauri 渲染进程版）。
 * 按 Electron 主进程版 getLyricAdapter 的逻辑，依次尝试多种获取方式。
 */
export async function getLyricAdapterWeb(
    params: IGetLyricParams,
    deps: IGetLyricAdapterDeps,
): Promise<ILyric.ILyricSource | null> {
    const { musicItem } = params;

    let rawLrc = musicItem.rawLrc;
    let lrcUrl = musicItem.lrc;
    let translation: string | undefined;

    // ─── Step 0: 用户关联歌词优先 ───
    const associated = await deps.mediaMeta.getAssociatedLyric(
        musicItem.platform,
        String(musicItem.id),
    );
    if (associated) {
        // 0a: 有缓存的歌词文本，直接返回
        if (associated.rawLrc) {
            return {
                rawLrc: associated.rawLrc,
                translation: associated.translation,
            };
        }

        // 0b: 有关联的 musicItem 但无缓存文本，调用其所属插件的 getLyric
        //     自引用保护：关联歌曲不能是自己（避免死循环）
        if (associated.musicItem && !isSameMedia(associated.musicItem, musicItem)) {
            try {
                const linkedSource = await deps.callPluginMethod({
                    platform: associated.musicItem.platform,
                    method: 'getLyric',
                    args: [associated.musicItem],
                });

                if (linkedSource?.rawLrc || linkedSource?.translation) {
                    const linkedRawLrc = linkedSource.rawLrc ?? linkedSource.translation;
                    const linkedTranslation = linkedSource.rawLrc
                        ? linkedSource.translation
                        : undefined;

                    // 回写缓存到 mediaMeta，下次无需再调插件
                    await deps.mediaMeta.setMeta(musicItem.platform, String(musicItem.id), {
                        associatedLyric: {
                            musicItem: associated.musicItem,
                            rawLrc: linkedRawLrc,
                            translation: linkedTranslation,
                        },
                    });

                    return {
                        rawLrc: linkedRawLrc,
                        translation: linkedTranslation,
                    };
                }
            } catch {
                // 关联歌词插件调用失败，继续后续步骤
            }
        }
    }

    // ─── Step 1: musicItem 自身已有 rawLrc，直接返回 ───
    if (rawLrc) {
        return {
            rawLrc,
            lrc: lrcUrl,
        };
    }

    // ─── Step 2: 读取本地同名 .lrc 文件 ───
    const localPath = await getLocalPath(musicItem, deps.mediaMeta, deps.musicItemProvider);
    if (localPath) {
        const { dir, base } = splitPath(localPath);
        const fileName = stripExt(base);
        const lrcPathWithoutExt = `${dir}${fileName}`;
        const lrcTranslationPathWithoutExt = `${dir}${fileName}-tr`;
        const exts = ['.lrc', '.LRC', '.txt'];

        for (const ext of exts) {
            const lrcFilePath = lrcPathWithoutExt + ext;
            if (await isFile(lrcFilePath)) {
                rawLrc = (await readTextFile(lrcFilePath)) ?? undefined;

                const trFilePath = lrcTranslationPathWithoutExt + ext;
                if (await isFile(trFilePath)) {
                    translation = (await readTextFile(trFilePath)) ?? undefined;
                }

                if (rawLrc) {
                    return {
                        rawLrc,
                        translation,
                        lrc: lrcUrl,
                    };
                }
            }
        }
    }

    // ─── Step 3: 调用插件 getLyric ───
    try {
        const lrcSource = await deps.callPluginMethod({
            platform: musicItem.platform,
            method: 'getLyric',
            args: [musicItem],
        });

        rawLrc = lrcSource?.rawLrc;
        lrcUrl = lrcSource?.lrc || lrcUrl;
        translation = lrcSource?.translation;

        if (rawLrc || translation) {
            // 仅有翻译无原文时，将翻译提升为原文
            if (!rawLrc) {
                rawLrc = translation;
                translation = undefined;
            }

            return {
                rawLrc,
                translation,
            };
        }
    } catch {
        // 插件获取歌词失败，继续下一步
    }

    // ─── Step 4: 通过 lrcUrl 远程获取 ───
    if (lrcUrl) {
        const text = await fetchText(lrcUrl);
        if (text) {
            rawLrc = text;

            return {
                rawLrc,
                lrc: lrcUrl,
                translation,
            };
        }
    }

    // ─── Step 5: 自动匹配——联网搜索歌词并缓存 ───
    const autoMatchEnabled = deps.isAutoMatchEnabled ? await deps.isAutoMatchEnabled() : false;
    if (autoMatchEnabled && musicItem.title && deps.listLyricSearchPlugins) {
        const query = `${musicItem.title}${musicItem.artist ? ` ${musicItem.artist}` : ''}`.trim();
        const plugins = deps.listLyricSearchPlugins();

        for (const { platform } of plugins) {
            // 不向歌曲自身所属插件重复请求（Step 3 已尝试过）
            if (platform === musicItem.platform) continue;

            try {
                const searchResult = await deps.callPluginMethod({
                    platform,
                    method: 'search',
                    args: [query, 1, 'lyric'],
                });

                const firstItem = searchResult?.data?.[0];
                if (!firstItem) continue;

                const lyricSource = await deps.callPluginMethod({
                    platform,
                    method: 'getLyric',
                    args: [firstItem],
                });

                if (lyricSource?.rawLrc || lyricSource?.translation) {
                    let matchedRawLrc = lyricSource.rawLrc;
                    let matchedTranslation = lyricSource.translation;
                    // 仅有翻译无原文时，将翻译提升为原文
                    if (!matchedRawLrc) {
                        matchedRawLrc = matchedTranslation;
                        matchedTranslation = undefined;
                    }

                    // 回写缓存到 mediaMeta，下次无需再联网
                    await deps.mediaMeta.setMeta(musicItem.platform, String(musicItem.id), {
                        associatedLyric: {
                            musicItem: firstItem,
                            rawLrc: matchedRawLrc,
                            translation: matchedTranslation,
                        },
                    });

                    return {
                        rawLrc: matchedRawLrc,
                        translation: matchedTranslation,
                    };
                }
            } catch {
                // 当前插件搜索/取词失败，尝试下一个
            }
        }
    }

    return null;
}
