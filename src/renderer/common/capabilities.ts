/**
 * 宿主 Web 能力探测
 *
 * WKWebView（macOS）里 navigator.mediaDevices 与 HTMLMediaElement.setSinkId
 * 都可能不存在：前者在自定义协议下不是安全上下文时为 undefined，
 * 后者 Safari 从未实现。直接调用会在启动阶段抛 TypeError 打断整个 bootstrap，
 * 因此所有调用点都必须先过这里。
 */

/** 音频输出设备枚举 / devicechange 监听是否可用 */
export function hasMediaDevices(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices;
}

/** 指定输出设备播放（setSinkId）是否可用 */
export function hasSetSinkId(): boolean {
    return typeof HTMLMediaElement !== 'undefined' &&
        'setSinkId' in HTMLMediaElement.prototype;
}

/** 媒体会话（锁屏 / 控制中心元数据与播控）是否可用 */
export function hasMediaSession(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaSession;
}

/** 异步剪贴板 API 是否可用（非安全上下文下为 undefined） */
export function hasClipboard(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;
}

/** 枚举音频输出设备；不支持时返回空数组 */
export async function listAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
    if (!hasMediaDevices()) {
        return [];
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter((d) => d.kind === 'audiooutput');
    } catch {
        return [];
    }
}

/** 写入剪贴板，返回是否成功 */
export async function writeClipboardText(text: string): Promise<boolean> {
    if (!hasClipboard()) {
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
