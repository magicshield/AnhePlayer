/**
 * Tauri 桥接：themepack 主题包
 *
 * 在 Tauri 环境下完整替代 Electron preload 的主题包能力：
 * - 内置主题（res/builtin-themes）与策展主题（res/theme-store/curated）通过 Vite 打包内联，
 *   因为 Tauri 包未携带 res 资源目录；合成 path 使用 `builtin-theme://` / `curated-theme://` 前缀
 * - 用户主题安装在 userData/anhe-player-themepacks 下（与 Electron 保持一致）
 * - .mftheme（zip）解压、远程下载安装、CSS/iframe/blurHash 注入、localStorage 缓存
 * - 主题切换通过 Tauri 事件广播给歌词/迷你窗口
 *
 * 注意：Tauri 侧没有 Node file:// 资源加载能力，主题包内 `@/` 引用一律重写为 data URL。
 */
// @ts-nocheck —— Vite 专属模块（import.meta.glob），commonjs 模式的 tsconfig 无法正确检查；类型安全由 Vite 构建与 ESLint 保障
import { nanoid } from 'nanoid';

import type { IThemePack, IThemePackConfig, IThemePackCache } from '@appTypes/infra/themepack';
import {
    CONTEXT_BRIDGE_KEY,
    THEMEPACK_STORAGE_KEY,
    THEMEPACK_STYLE_NODE_ID,
    THEMEPACK_BLURHASH_NODE_ID,
    THEMEPACK_IFRAME_NODE_ID,
    THEMEPACK_DIR_NAME,
} from '@infra/themepack/common/constant';
import { tauriInvoke, tauriEmit, tauriListen } from '../ipc';

/** 主题切换广播事件名（Tauri 事件名不允许 '@'，独立命名） */
const THEME_SWITCHED_EVENT = 'themepack-theme-switched';

/** 打包内联的主题资源（?raw 字符串） */
const builtinRawFiles = import.meta.glob('/res/builtin-themes/*/*.{json,css,svg,html}', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const curatedRawFiles = import.meta.glob('/res/theme-store/curated/*/*.{json,css,svg,html}', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

// ─── 打包主题的分组索引 ───

interface IBundledPack {
    /** 合成路径（作为 IThemePack.path） */
    path: string;
    /** 文件名 → 内容 的映射 */
    files: Record<string, string>;
}

function groupBundledFiles(rawFiles: Record<string, string>): Map<string, IBundledPack> {
    const map = new Map<string, IBundledPack>();
    for (const [fullPath, content] of Object.entries(rawFiles)) {
        // 形如 /res/builtin-themes/light/config.json
        const segments = fullPath.split('/');
        const fileName = segments[segments.length - 1];
        const dirKey = segments[segments.length - 2];
        let pack = map.get(dirKey);
        if (!pack) {
            pack = { path: dirKey, files: {} };
            map.set(dirKey, pack);
        }
        pack.files[fileName] = content;
    }
    return map;
}

const builtinGrouped = groupBundledFiles(builtinRawFiles);
const curatedGrouped = groupBundledFiles(curatedRawFiles);

const BUILTIN_PATH_PREFIX = 'builtin-theme://';
const CURATED_PATH_PREFIX = 'curated-theme://';

// ─── 通用工具 ───

/** FNV-1a 32bit 文本哈希（非密码学用途，仅作变更检测与本地唯一标识） */
function hashText(raw: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${h.toString(16).padStart(8, '0')}${raw.length.toString(16)}`;
}

function normalizePath(p: string): string {
    return p.replace(/[\\/]+/g, '/');
}

function isSubPath(targetPath: string, parentDir: string): boolean {
    const base = normalizePath(parentDir).replace(/\/$/, '') + '/';
    return normalizePath(targetPath).startsWith(base);
}

function getAppPath(key: 'userData' | 'temp'): string {
    const ctx = (globalThis as any).globalContext;
    const value = ctx?.appPath?.[key];
    return typeof value === 'string' ? value : '';
}

function getThemePackBaseDir(): string {
    const userData = getAppPath('userData');
    return userData ? `${userData}/${THEMEPACK_DIR_NAME}` : '';
}

/** 扩展名 → MIME（主题包内资源重写用，覆盖常见类型即可） */
const MIME_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    html: 'text/html',
    txt: 'text/plain',
};

function extOf(p: string): string {
    const m = p.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : '';
}

function bytesToBase64(bytes: Uint8Array): string {
    // 分块避免超长 String.fromCharCode 调用栈溢出
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function bytesToDataUrl(bytes: Uint8Array, ext: string): string {
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function textToDataUrl(text: string, ext: string): string {
    const mime = MIME_MAP[ext] || 'text/plain';
    if (mime === 'image/svg+xml' || mime === 'text/html') {
        // 文本型资源使用 utf8 编码，便于调试且体积更小
        return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
    }
    return bytesToDataUrl(new TextEncoder().encode(text), ext);
}

/** 读取磁盘文件并转为 data URL；失败返回 null */
async function readFileAsDataUrl(absPath: string): Promise<string | null> {
    try {
        const res = await tauriInvoke<number[]>('fs_read_file', { path: absPath });
        if (!Array.isArray(res)) return null;
        return bytesToDataUrl(new Uint8Array(res), extOf(absPath));
    } catch {
        return null;
    }
}

/** 从打包资源映射中取文件并转为 data URL；找不到返回 null */
function bundledFileToDataUrl(files: Record<string, string>, relPath: string): string | null {
    const fileName = normalizePath(relPath).split('/').pop() || '';
    const content = files[fileName];
    if (content === undefined) return null;
    return textToDataUrl(content, extOf(fileName));
}

// ─── @/ 别名重写 ───

/**
 * 安全解析 `@/` 别名到主题包目录下的相对路径。
 * 返回 null 表示路径逃逸（不替换，保留原文）。
 */
function resolveAliasRelPath(rawPath: string): string | null {
    const relative = normalizePath(rawPath.replace(/^@\//, ''));
    if (!relative || relative.startsWith('../') || relative.includes('/../') || relative.includes(':')) {
        return null;
    }
    return relative;
}

/**
 * 替换 CSS 中 url() 与 HTML 中 src/href 的 `@/` 引用为 data URL。
 * resolveAsset 负责把相对路径转成可用 URL（打包资源走内存，用户主题走磁盘）。
 */
async function replaceAlias(
    rawText: string,
    resolveAsset: (relPath: string) => Promise<string | null>,
): Promise<string> {
    const pattern =
        /(?:url\(\s*['"]?)(@\/[^)'"\s]*)(?:['"]?\s*\))|(?:(?:src|href)\s*=\s*['"])(@\/[^'"]*)['"]/gi;
    const importPattern = /@import\s+['"](@\/[^'"]*)['"];?/gi;

    const matches = new Map<string, string>();
    const collect = (match: string, ...groups: (string | undefined)[]) => {
        const rawPath = groups.find((g) => g !== undefined) ?? '';
        matches.set(rawPath, match);
        return match;
    };
    rawText.replace(pattern, collect).replace(importPattern, collect);

    let result = rawText;
    for (const rawPath of matches.keys()) {
        const relPath = resolveAliasRelPath(rawPath);
        if (!relPath) continue;
        const url = await resolveAsset(relPath);
        if (!url) continue;
        // 全局替换该引用（含 url(@/x)、src="@/x" 等所有出现位置）
        result = result.split(rawPath).join(url);
    }
    return result;
}

// ─── DOM 操作（与 Electron preload 行为保持一致） ───

function whenParentReady(
    getParent: () => HTMLElement | null,
    callback: (parent: HTMLElement) => void,
): void {
    const parent = getParent();
    if (parent) {
        callback(parent);
    } else {
        document.addEventListener(
            'DOMContentLoaded',
            () => {
                const p = getParent();
                if (p) callback(p);
            },
            { once: true },
        );
    }
}

function injectCss(css: string): void {
    let styleNode = document.getElementById(THEMEPACK_STYLE_NODE_ID) as HTMLStyleElement | null;
    if (!styleNode) {
        styleNode = document.createElement('style');
        styleNode.id = THEMEPACK_STYLE_NODE_ID;
        whenParentReady(
            () => document.head,
            (head) => head.appendChild(styleNode!),
        );
    }
    styleNode.textContent = css;
}

function removeCss(): void {
    document.getElementById(THEMEPACK_STYLE_NODE_ID)?.remove();
}

function renderBlurHash(blurHashStr: string): void {
    document.getElementById(THEMEPACK_BLURHASH_NODE_ID)?.remove();

    const container = document.createElement('div');
    container.id = THEMEPACK_BLURHASH_NODE_ID;
    container.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'width: 100vw',
        'height: 100vh',
        'z-index: 0',
        'pointer-events: none',
        'transition: opacity 0.3s ease-out',
    ].join(';');
    whenParentReady(
        () => document.body,
        (body) => body.prepend(container),
    );

    import('blurhash')
        .then(({ decode }) => {
            const width = 32;
            const height = 32;
            try {
                const pixels = decode(blurHashStr, width, height);
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.style.cssText = 'width:100%;height:100%;';
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
                    ctx.putImageData(imageData, 0, 0);
                    container.appendChild(canvas);
                }
            } catch {
                // blurHash 无效，忽略
            }
        })
        .catch(() => {
            // blurhash 模块加载失败，忽略
        });
}

function removeBlurHash(): void {
    const el = document.getElementById(THEMEPACK_BLURHASH_NODE_ID);
    if (!el) return;
    el.removeAttribute('id');
    el.style.opacity = '0';
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
}

function destroyIframe(): void {
    document.getElementById(THEMEPACK_IFRAME_NODE_ID)?.remove();
}

async function applyIframe(themePack: IThemePack): Promise<void> {
    destroyIframe();
    if (!themePack.iframe?.app) return;

    const iframeSource = themePack.iframe.app;
    const iframe = document.createElement('iframe');
    iframe.id = THEMEPACK_IFRAME_NODE_ID;
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    iframe.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'width: 100%',
        'height: 100%',
        'border: none',
        'z-index: 0',
        'pointer-events: none',
        'opacity: 0',
        'transition: opacity 0.3s ease-in',
    ].join(';');

    iframe.onload = () => {
        iframe.style.opacity = '1';
        removeBlurHash();
    };

    if (iframeSource.startsWith('http://') || iframeSource.startsWith('https://')) {
        iframe.src = iframeSource;
    } else {
        const relPath = resolveAliasRelPath(iframeSource);
        const rawHtml = relPath ? await readThemeFileAsText(themePack, relPath) : null;
        if (rawHtml) {
            iframe.srcdoc = await replaceAlias(rawHtml, (rel) => readThemeAssetUrl(themePack, rel));
        }
    }

    document.body.prepend(iframe);
}

// ─── 主题包文件访问（打包内存 / 用户磁盘） ───

function isBundledPath(p: string): boolean {
    return p.startsWith(BUILTIN_PATH_PREFIX) || p.startsWith(CURATED_PATH_PREFIX);
}

function getBundledPack(themePackPath: string): IBundledPack | null {
    if (themePackPath.startsWith(BUILTIN_PATH_PREFIX)) {
        const dirKey = themePackPath.slice(BUILTIN_PATH_PREFIX.length);
        const pack = builtinGrouped.get(dirKey);
        return pack ? { path: themePackPath, files: pack.files } : null;
    }
    if (themePackPath.startsWith(CURATED_PATH_PREFIX)) {
        const dirKey = themePackPath.slice(CURATED_PATH_PREFIX.length);
        const pack = curatedGrouped.get(dirKey);
        return pack ? { path: themePackPath, files: pack.files } : null;
    }
    return null;
}

async function readThemeFileAsText(themePack: IThemePack, relPath: string): Promise<string | null> {
    const bundled = getBundledPack(themePack.path);
    if (bundled) {
        const fileName = normalizePath(relPath).split('/').pop() || '';
        return bundled.files[fileName] ?? null;
    }
    try {
        return (await tauriInvoke<string>('fs_read_file', {
            path: `${normalizePath(themePack.path)}/${normalizePath(relPath)}`,
            encoding: 'utf-8',
        })) as string;
    } catch {
        return null;
    }
}

async function readThemeAssetUrl(themePack: IThemePack, relPath: string): Promise<string | null> {
    const bundled = getBundledPack(themePack.path);
    if (bundled) {
        return bundledFileToDataUrl(bundled.files, relPath);
    }
    return readFileAsDataUrl(`${normalizePath(themePack.path)}/${normalizePath(relPath)}`);
}

// ─── 主题包解析 ───

function buildPackFromConfig(
    configRaw: string,
    packPath: string,
    extra: { builtin?: boolean },
): IThemePack | null {
    try {
        const config: IThemePackConfig = JSON.parse(configRaw);
        if (!config.name) return null;
        return {
            ...config,
            path: packPath,
            hash: hashText(configRaw),
            ...(extra.builtin ? { builtin: true } : {}),
        };
    } catch {
        return null;
    }
}

/** 解析打包内联主题（preview/thumb 里的 @/ 引用在异步阶段补齐） */
async function parseBundledPack(
    prefix: string,
    dirKey: string,
    builtin: boolean,
): Promise<IThemePack | null> {
    const grouped = prefix === BUILTIN_PATH_PREFIX ? builtinGrouped : curatedGrouped;
    const bundle = grouped.get(dirKey);
    if (!bundle) return null;
    const configRaw = bundle.files['config.json'];
    if (!configRaw) return null;

    const packPath = `${prefix}${dirKey}`;
    const pack = buildPackFromConfig(configRaw, packPath, { builtin });
    if (!pack) return null;

    // preview/thumb 的 @/ 引用 → data URL
    if (pack.preview && !pack.preview.startsWith('#')) {
        const rel = resolveAliasRelPath(pack.preview);
        const url = rel ? bundledFileToDataUrl(bundle.files, rel) : null;
        pack.preview = url ?? undefined;
    }
    if (pack.thumb) {
        const rel = resolveAliasRelPath(pack.thumb);
        const url = rel ? bundledFileToDataUrl(bundle.files, rel) : null;
        pack.thumb = url ?? undefined;
    }
    return pack;
}

/** 解析用户磁盘主题包目录 */
async function parseUserThemePack(dirPath: string): Promise<IThemePack | null> {
    try {
        const configRaw = (await tauriInvoke<string>('fs_read_file', {
            path: `${normalizePath(dirPath)}/config.json`,
            encoding: 'utf-8',
        })) as string;
        const pack = buildPackFromConfig(configRaw, normalizePath(dirPath), {});
        if (!pack) return null;

        if (pack.preview && !pack.preview.startsWith('#')) {
            const rel = resolveAliasRelPath(pack.preview);
            const url = rel ? await readFileAsDataUrl(`${pack.path}/${rel}`) : null;
            pack.preview = url ?? undefined;
        }
        if (pack.thumb) {
            const rel = resolveAliasRelPath(pack.thumb);
            const url = rel ? await readFileAsDataUrl(`${pack.path}/${rel}`) : null;
            pack.thumb = url ?? undefined;
        }
        return pack;
    } catch {
        return null;
    }
}

async function parseThemePackByPath(themePackPath: string): Promise<IThemePack | null> {
    if (themePackPath.startsWith(BUILTIN_PATH_PREFIX)) {
        return parseBundledPack(
            BUILTIN_PATH_PREFIX,
            themePackPath.slice(BUILTIN_PATH_PREFIX.length),
            true,
        );
    }
    if (themePackPath.startsWith(CURATED_PATH_PREFIX)) {
        return parseBundledPack(
            CURATED_PATH_PREFIX,
            themePackPath.slice(CURATED_PATH_PREFIX.length),
            false,
        );
    }
    return parseUserThemePack(themePackPath);
}

/** 读取主题包 CSS（不含别名替换，替换在注入前进行） */
async function readThemeCss(themePack: IThemePack): Promise<string> {
    return (await readThemeFileAsText(themePack, 'index.css')) ?? '';
}

async function buildInjectedCss(themePack: IThemePack): Promise<string> {
    const raw = await readThemeCss(themePack);
    if (!raw) return '';
    return replaceAlias(raw, (rel) => readThemeAssetUrl(themePack, rel));
}

// ─── 缓存 ───

function readCache(): IThemePackCache | null {
    try {
        const raw = localStorage.getItem(THEMEPACK_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as IThemePackCache;
    } catch {
        return null;
    }
}

function writeCache(themePack: IThemePack, css: string): void {
    const cache: IThemePackCache = {
        path: themePack.path,
        hash: themePack.hash,
        css,
        blurHash: themePack.iframe?.app ? (themePack.blurHash ?? null) : null,
        hasIframe: !!themePack.iframe?.app,
    };
    try {
        localStorage.setItem(THEMEPACK_STORAGE_KEY, JSON.stringify(cache));
    } catch {
        // localStorage 已满或不可用，忽略
    }
}

function clearCache(): void {
    localStorage.removeItem(THEMEPACK_STORAGE_KEY);
}

/**
 * 启动早期同步注入缓存 CSS（与 Electron preload 的同步阶段对齐）。
 * 仅使用 localStorage，不依赖任何异步 IPC，保证首帧即生效。
 */
function injectCachedCssSync(): void {
    const cached = readCache();
    if (cached?.css) {
        injectCss(cached.css);
    }
}

// ─── zip 解压（.mftheme / 远程主题包） ───

interface IZipEntry {
    name: string;
    data: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 极简 zip 解析（仅支持 stored / deflate 两种压缩方式，不含 zip64，主题包足够小）。
 */
async function readZipEntries(bytes: Uint8Array): Promise<IZipEntry[]> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 扫描 EOCD（从文件尾向前，最多 64KB 注释空间）
    let eocd = -1;
    const scanStart = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= scanStart; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('Invalid zip: EOCD not found');

    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);

    const entries: IZipEntry[] = [];
    for (let i = 0; i < entryCount; i++) {
        if (view.getUint32(offset, true) !== 0x02014b50) {
            throw new Error('Invalid zip: central directory corrupt');
        }
        const flags = view.getUint16(offset + 8, true);
        const method = view.getUint16(offset + 10, true);
        const compSize = view.getUint32(offset + 20, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
        const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'utf-8').decode(nameBytes);

        offset += 46 + nameLen + extraLen + commentLen;

        if (name.endsWith('/')) continue; // 目录条目

        // 防 zip slip：拒绝绝对路径与上跳路径
        const normName = normalizePath(name);
        if (
            normName.startsWith('/') ||
            /^[a-zA-Z]:/.test(normName) ||
            normName.split('/').some((seg) => seg === '..')
        ) {
            continue;
        }

        // 定位本地头并计算数据偏移
        if (view.getUint32(localOffset, true) !== 0x04034b50) {
            throw new Error('Invalid zip: local header corrupt');
        }
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressed = bytes.subarray(dataStart, dataStart + compSize);

        let data: Uint8Array;
        if (method === 0) {
            data = compressed;
        } else if (method === 8) {
            data = await inflateRaw(compressed);
        } else {
            throw new Error(`Unsupported zip compression method: ${method}`);
        }
        entries.push({ name: normName, data });
    }
    return entries;
}

/** 将 zip 条目写入目标目录 */
async function writeZipEntries(entries: IZipEntry[], targetDir: string): Promise<void> {
    for (const entry of entries) {
        const filePath = `${normalizePath(targetDir)}/${entry.name}`;
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir) {
            await tauriInvoke('fs_mkdir', { path: dir });
        }
        await tauriInvoke('fs_write_file', {
            path: filePath,
            content: Array.from(entry.data),
            isBinary: true,
        });
    }
}

// ─── 业务 API ───

async function loadAllThemePacks(): Promise<IThemePack[]> {
    // 打包内联：内置主题 + 策展主题（策展主题仅作为“可安装源”，不计入已安装列表）
    const builtinPacks = (
        await Promise.all(
            Array.from(builtinGrouped.keys()).map((dirKey) =>
                parseBundledPack(BUILTIN_PATH_PREFIX, dirKey, true),
            ),
        )
    ).filter((p): p is IThemePack => p !== null);

    // 用户安装目录扫描
    const baseDir = getThemePackBaseDir();
    let userPacks: IThemePack[] = [];
    if (baseDir) {
        try {
            await tauriInvoke('fs_mkdir', { path: baseDir });
            const names = await tauriInvoke<string[]>('fs_read_dir', { path: baseDir });
            userPacks = (
                await Promise.all(
                    (names || []).map((name) =>
                        parseUserThemePack(`${baseDir}/${normalizePath(name)}`),
                    ),
                )
            ).filter((p): p is IThemePack => p !== null);
        } catch {
            userPacks = [];
        }
    }

    return [...builtinPacks, ...userPacks];
}

async function initCurrentTheme(): Promise<IThemePack | null> {
    const cache = readCache();
    if (!cache) {
        removeCss();
        return null;
    }

    const themePack = await parseThemePackByPath(cache.path);
    if (!themePack) {
        removeCss();
        removeBlurHash();
        clearCache();
        return null;
    }

    if (themePack.hash !== cache.hash) {
        // 主题包内容已变化 → 重新加载 CSS 与缓存
        const css = await buildInjectedCss(themePack);
        injectCss(css);
        writeCache(themePack, css);

        removeBlurHash();
        if (themePack.iframe?.app && themePack.blurHash) {
            renderBlurHash(themePack.blurHash);
        }
    }

    if (themePack.iframe?.app) {
        await applyIframe(themePack);
    } else {
        removeBlurHash();
    }

    return themePack;
}

function validateThemePackPath(themePackPath: string): boolean {
    if (isBundledPath(themePackPath)) return true;
    const baseDir = getThemePackBaseDir();
    return !!baseDir && isSubPath(themePackPath, baseDir);
}

async function selectTheme(themePack: IThemePack | null): Promise<void> {
    destroyIframe();
    removeBlurHash();

    if (!themePack) {
        removeCss();
        clearCache();
        tauriEmit(THEME_SWITCHED_EVENT).catch(() => {});
        return;
    }

    if (!validateThemePackPath(themePack.path)) {
        throw new Error('Invalid theme pack path');
    }

    const css = await buildInjectedCss(themePack);
    injectCss(css);
    writeCache(themePack, css);

    if (themePack.iframe?.app) {
        if (themePack.blurHash) {
            renderBlurHash(themePack.blurHash);
        }
        await applyIframe(themePack);
    }

    tauriEmit(THEME_SWITCHED_EVENT).catch(() => {});
}

/** 从"安装源目录"路径中提取策展主题 id（兼容 res 为空字符串的 Tauri 路径形态） */
function extractCuratedId(srcDirPath: string): string | null {
    const norm = normalizePath(srcDirPath).replace(/\/+$/, '');
    const m = norm.match(/(?:^|\/)(?:theme-store\/curated)\/([^/]+)$/);
    return m ? m[1] : null;
}

/** 将打包内联的策展主题落盘为一份用户主题 */
async function materializeCuratedPack(curatedId: string): Promise<IThemePack | null> {
    const baseDir = getThemePackBaseDir();
    const bundle = curatedGrouped.get(curatedId);
    if (!baseDir || !bundle) return null;

    const targetDir = `${baseDir}/${nanoid(12)}`;
    try {
        await tauriInvoke('fs_mkdir', { path: targetDir });
        for (const [fileName, content] of Object.entries(bundle.files)) {
            await tauriInvoke('fs_write_file', {
                path: `${targetDir}/${fileName}`,
                content,
                isBinary: false,
            });
        }
        const pack = await parseUserThemePack(targetDir);
        if (!pack) {
            await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
            return null;
        }
        return pack;
    } catch {
        await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
        return null;
    }
}

/** 递归复制目录（主题包层级很浅，限制深度防意外） */
async function copyDirRecursive(src: string, dest: string, depth = 0): Promise<void> {
    if (depth > 5) return;
    await tauriInvoke('fs_mkdir', { path: dest });
    const names = await tauriInvoke<string[]>('fs_read_dir', { path: src });
    for (const name of names || []) {
        const srcChild = `${normalizePath(src)}/${normalizePath(name)}`;
        const destChild = `${normalizePath(dest)}/${normalizePath(name)}`;
        const isDir = await tauriInvoke<boolean>('fs_is_folder', { path: srcChild });
        if (isDir) {
            await copyDirRecursive(srcChild, destChild, depth + 1);
        } else {
            await tauriInvoke('fs_copy_file', { src: srcChild, dest: destChild });
        }
    }
}

async function installThemePackFromDirectory(srcDirPath: string): Promise<IThemePack | null> {
    try {
        // 1) 策展主题：从打包内联资源落盘
        const curatedId = extractCuratedId(srcDirPath);
        if (curatedId) {
            return await materializeCuratedPack(curatedId);
        }

        // 2) 真实目录：递归复制到用户主题目录
        const baseDir = getThemePackBaseDir();
        if (!baseDir) return null;
        const isDir = await tauriInvoke<boolean>('fs_is_folder', { path: srcDirPath });
        if (!isDir) return null;

        const targetDir = `${baseDir}/${nanoid(12)}`;
        try {
            await copyDirRecursive(srcDirPath, targetDir);
            const pack = await parseUserThemePack(targetDir);
            if (!pack) {
                await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
                return null;
            }
            return pack;
        } catch {
            await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
            return null;
        }
    } catch {
        return null;
    }
}

async function installThemePack(mfthemePath: string): Promise<IThemePack | null> {
    const baseDir = getThemePackBaseDir();
    if (!baseDir) return null;
    const targetDir = `${baseDir}/${nanoid(12)}`;
    try {
        const bytes = await tauriInvoke<number[]>('fs_read_file', { path: mfthemePath });
        if (!Array.isArray(bytes)) return null;
        const entries = await readZipEntries(new Uint8Array(bytes));
        await tauriInvoke('fs_mkdir', { path: targetDir });
        await writeZipEntries(entries, targetDir);
        const pack = await parseUserThemePack(targetDir);
        if (!pack) {
            await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
            return null;
        }
        return pack;
    } catch {
        await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
        return null;
    }
}

async function installRemoteThemePack(remoteUrl: string): Promise<IThemePack | null> {
    const baseDir = getThemePackBaseDir();
    if (!baseDir) return null;
    const targetDir = `${baseDir}/${nanoid(12)}`;
    try {
        const resp = await fetch(remoteUrl);
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const entries = await readZipEntries(new Uint8Array(buf));
        await tauriInvoke('fs_mkdir', { path: targetDir });
        await writeZipEntries(entries, targetDir);
        const pack = await parseUserThemePack(targetDir);
        if (!pack) {
            await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
            return null;
        }
        return pack;
    } catch {
        await tauriInvoke('fs_remove', { path: targetDir }).catch(() => {});
        return null;
    }
}

async function uninstallThemePack(themePack: IThemePack): Promise<void> {
    if (themePack.builtin || isBundledPath(themePack.path)) {
        throw new Error('Cannot uninstall builtin theme');
    }
    const baseDir = getThemePackBaseDir();
    if (!baseDir || !isSubPath(themePack.path, baseDir)) {
        throw new Error('Invalid theme pack path');
    }
    await tauriInvoke('fs_remove', { path: themePack.path });
}

// ─── 供 UI 使用：打包资源的 URL 解析 ───

/**
 * 把 res 相对路径解析为打包内联资源的 data URL。
 * Tauri 包不含 res 目录，主题市场等 UI 需要以此替换 file:/// 链接。
 */
export function resolveBundledResUrl(relativePath: string): string | null {
    const full = `/res/${normalizePath(relativePath).replace(/^\/+/, '')}`;
    const content = curatedRawFiles[full] ?? builtinRawFiles[full];
    if (content === undefined) return null;
    return textToDataUrl(content, extOf(full));
}

/**
 * 策展主题缩略图 URL（供主题市场卡片使用）。
 */
export function getCuratedThemeAssetUrl(themeId: string, fileName: string): string | null {
    const bundle = curatedGrouped.get(themeId);
    if (!bundle) return null;
    return bundledFileToDataUrl(bundle.files, fileName);
}

// ─── 注册 ───

const mod = {
    initCurrentTheme,
    selectTheme,
    loadAllThemePacks,
    installThemePack,
    installThemePackFromDirectory,
    installRemoteThemePack,
    uninstallThemePack,
    // 供 UI 替换 file:/// 链接的打包资源解析器
    resolveBundledResUrl,
    getCuratedThemeAssetUrl,
};

export function registerThemePackBridge(): void {
    if (typeof window === 'undefined') return;

    (window as any)[CONTEXT_BRIDGE_KEY] = mod;

    // 同步阶段：立即注入缓存 CSS（首帧生效）
    injectCachedCssSync();

    // 监听主题切换广播：主窗口与辅助窗口都从 localStorage 重新注入
    tauriListen(THEME_SWITCHED_EVENT, () => {
        injectCachedCssSync();
    }).catch(() => {});
}
