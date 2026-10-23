/**
 * fsUtil — 渲染进程层
 *
 * 提供类型安全的文件系统操作 API。
 * 底层由 Tauri Rust commands 提供。
 */
import type { IFsUtilMod } from '@appTypes/infra/fsUtil';
import { CONTEXT_BRIDGE_KEY } from './common/constant';

const mod = window[CONTEXT_BRIDGE_KEY as any] as unknown as IFsUtilMod;

class FsUtilRenderer {
    /**
     * 写入文件。
     * @param path 文件路径
     * @param data 文件内容
     * @param options 可选编码和标志
     */
    public writeFile(
        path: string,
        data: string | Buffer,
        options?: { encoding?: BufferEncoding; flag?: string },
    ): Promise<void> {
        return mod.writeFile(path, data, options);
    }

    /**
     * 读取文件。
     * @param path 文件路径
     * @param encoding 指定编码时返回 string，否则返回 Buffer
     */
    public readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer> {
        return mod.readFile(path, encoding);
    }

    /**
     * 判断路径是否为文件。
     * 路径不存在时返回 false。
     */
    public isFile(path: string): Promise<boolean> {
        return mod.isFile(path);
    }

    /**
     * 判断路径是否为文件夹。
     * 路径不存在时返回 false。
     */
    public isFolder(path: string): Promise<boolean> {
        return mod.isFolder(path);
    }

    /**
     * 递归删除文件或文件夹。
     */
    public rimraf(path: string): Promise<void> {
        return mod.rimraf(path);
    }

    /**
     * 为本地路径添加 `file://` 协议前缀。
     * 如果已有 `file:` 前缀则原样返回。
     */
    public addFileScheme(filePath: string): string {
        return mod.addFileScheme(filePath);
    }

    /**
     * 将本地文件路径转换为 Tauri asset 协议 URL（供 audio 元素在 WebView2 中直接播放）。
     * WebView2 禁止从 http 页面加载 file:// 资源（audio 报 MEDIA_ERR_SRC_NOT_SUPPORTED），
     * 本地文件播放必须走 asset 协议。
     */
    public pathToAssetUrl(filePath: string): string {
        const internals = (window as any).__TAURI_INTERNALS__;
        if (internals?.convertFileSrc) {
            try {
                return internals.convertFileSrc(filePath, 'asset');
            } catch {
                /* 回退到手工拼接 */
            }
        }
        return `http://asset.localhost/${encodeURIComponent(filePath)}`;
    }

    /**
     * 将 `file://` URL 转换为本地文件系统路径。
     * 与 `addFileScheme` 互为逆操作。
     * @throws {TypeError} 当传入的不是 `file:` 协议的 URL 时抛出
     */
    public fileUrlToPath(fileUrl: string): string {
        return mod.fileUrlToPath(fileUrl);
    }

    /**
     * 规范化文件路径（解析 `.`、`..`、多余分隔符等）。
     */
    public normalizePath(filePath: string): string {
        return mod.normalizePath(filePath);
    }

    /**
     * 当前平台的路径分隔符（Windows: `\\`，macOS/Linux: `/`）。
     */
    public get pathSep(): string {
        return mod.pathSep;
    }
}

const fsUtil = new FsUtilRenderer();
export default fsUtil;
