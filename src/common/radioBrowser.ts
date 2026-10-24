export const RADIO_BROWSER_PLATFORM = 'radio-browser';
export const RADIO_BROWSER_WEBSITE = 'https://www.radio-browser.info/';

export interface IRadioBrowserMetadata {
    country: string;
    countryCode: string;
    language: string;
    tags: string[];
    codec: string;
    bitrate: number;
    isHls: boolean;
    homepage?: string;
    geoLat?: number;
    geoLong?: number;
    clickCount: number;
    clickTrend: number;
    votes: number;
}

export interface IRadioBrowserMusicItem extends IMusic.IMusicItem {
    platform: typeof RADIO_BROWSER_PLATFORM;
    url: string;
    radioBrowser: IRadioBrowserMetadata;
}

export function isRadioBrowserMedia(
    item: Pick<IMedia.IMediaBase, 'platform'> | null | undefined,
): boolean {
    return item?.platform === RADIO_BROWSER_PLATFORM;
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4) return false;

    const octets = parts.map(Number);
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

    const [a, b, c] = octets;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0 && c === 0) ||
        (a === 192 && b === 0 && c === 2) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
    );
}

function isPrivateIpv6(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host.includes(':')) return false;
    if (host === '::' || host === '::1' || host.startsWith('::ffff:')) return true;

    const first = host.split(':', 1)[0];
    if (
        first.startsWith('fc') ||
        first.startsWith('fd') ||
        first.startsWith('fec') ||
        first.startsWith('fed') ||
        first.startsWith('fee') ||
        first.startsWith('fef')
    ) {
        return true;
    }
    if (/^fe[89ab]/.test(first) || first.startsWith('ff')) return true;

    return false;
}

/**
 * 校验公共电台远程资源地址。该检查只负责阻断显式本地地址；DNS 与重定向仍由底层请求层处理。
 */
export function isSafeRadioRemoteUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0) return false;

    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        if (url.username || url.password) return false;

        const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
        if (
            !hostname ||
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.localdomain')
        ) {
            return false;
        }

        return !isPrivateIpv4(hostname) && !isPrivateIpv6(hostname);
    } catch {
        return false;
    }
}
