/**
 * data 层小工具：跨平台路径字符串操作（renderer 无 node:path）
 */

export function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/** 拼接目录与文件名（保持目录原有分隔符风格） */
export function joinPath(dir: string, name: string): string {
    if (!dir) return name;
    const sep = dir.includes('\\') ? '\\' : '/';
    return dir.replace(/[\\/]+$/, '') + sep + name;
}

/** 取父目录（保留原始分隔符） */
export function dirnameOf(p: string): string {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx > 0 ? p.slice(0, idx) : '';
}

export function baseNameOf(p: string): string {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx >= 0 ? p.slice(idx + 1) : p;
}

export function baseNameNoExt(p: string): string {
    const base = baseNameOf(p);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
}

/** 扩展名（含点，小写）；无扩展名返回空串 */
export function extOf(p: string): string {
    const base = baseNameOf(p);
    const dot = base.lastIndexOf('.');
    return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

/** 路径比较键（统一分隔符、去尾斜杠、小写——Windows 大小写不敏感） */
export function pathKey(p: string): string {
    return normalizePath(p).replace(/\/+$/, '').toLowerCase();
}

/** 本地路径 → file:// URL（Windows 盘符路径为主场景） */
export function fileUrlFromPath(p: string): string {
    const norm = normalizePath(p);
    const encoded = norm
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
    if (/^[A-Za-z]:/.test(norm)) {
        return 'file:///' + encoded.replace(/^([A-Za-z])%3A/, '$1:');
    }
    return 'file://' + (encoded.startsWith('/') ? encoded : `/${encoded}`);
}
