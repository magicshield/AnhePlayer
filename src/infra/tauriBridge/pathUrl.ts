/**
 * 本地路径 ⇄ file:// URL 转换（Tauri 桥接层共用）
 *
 * 分隔符按宿主平台返回，与 Electron 下 path.parse / fileURLToPath 语义对齐，
 * 保证 macOS/Linux 上不会出现被反斜杠污染的路径。
 */
import { isWindowsHost } from './hostPlatform';

/** 本地路径 → file:// URL（Windows 盘符为 `file:///C:/…`，POSIX 为 `file:///Users/…`） */
export function toFileUrl(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const isWindowsDrive = /^[A-Za-z]:/.test(normalized);
    const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
    const encoded = withLeadingSlash
        .split('/')
        .map((seg, i) => (isWindowsDrive && i === 1 ? seg : encodeURIComponent(seg)))
        .join('/');
    return `file://${encoded}`;
}

/** file:// URL → 宿主原生路径 */
export function fromFileUrl(fileUrl: string): string {
    const raw = fileUrl.replace(/^file:\/\/([^/]+)?(\/.*)?$/, (_m, host, rest) => {
        // file://localhost/… 与 file:///… 等价；Windows 网络路径（\\nas\share）保留 host
        if (!host || host === 'localhost') {
            return rest ?? '';
        }
        return `//${host}${rest ?? ''}`;
    });
    const p = decodeURIComponent(raw);
    if (isWindowsHost()) {
        // file:///C:/x → /C:/x，去掉 URL 定界带来的前导斜杠再换分隔符
        const native = /^[/\\]?[A-Za-z]:/.test(p) ? p.replace(/^[/\\]/, '') : p;
        return native.replace(/\//g, '\\');
    }
    return p.startsWith('/') ? p : `/${p}`;
}
