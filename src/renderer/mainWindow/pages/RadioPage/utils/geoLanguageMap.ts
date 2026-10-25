/**
 * 国家和语言中文化映射工具
 * 基于标准 Intl.DisplayNames 与常见语种字典
 */

let intlRegion: Intl.DisplayNames | null = null;
let intlLang: Intl.DisplayNames | null = null;

try {
    if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
        intlRegion = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
        intlLang = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
    }
} catch {
    // 降级使用内置字典与原生回退
}

const REGION_OVERRIDE_MAP: Record<string, string> = {
    HK: '中国香港',
    MO: '中国澳门',
    TW: '中国台湾',
};

const LANGUAGE_CN_MAP: Record<string, string> = {
    english: '英语',
    spanish: '西班牙语',
    german: '德语',
    french: '法语',
    chinese: '中文',
    mandarin: '普通话',
    cantonese: '粤语',
    russian: '俄语',
    italian: '意大利语',
    greek: '希腊语',
    dutch: '荷兰语',
    portuguese: '葡萄牙语',
    polish: '波兰语',
    arabic: '阿拉伯语',
    hindi: '印地语',
    romanian: '罗马尼亚语',
    romania: '罗马尼亚语',
    română: '罗马尼亚语',
    românä: '罗马尼亚语',
    turkish: '土耳其语',
    turkçe: '土耳其语',
    serbian: '塞尔维亚语',
    tamil: '泰米尔语',
    hungarian: '匈牙利语',
    ukrainian: '乌克兰语',
    ukranian: '乌克兰语',
    croatian: '克罗地亚语',
    indonesian: '印度尼西亚语',
    'bahasa indonesia': '印度尼西亚语',
    bulgarian: '保加利亚语',
    czech: '捷克语',
    nepali: '尼泊尔语',
    japanese: '日语',
    korean: '韩语',
    slovak: '斯洛伐克语',
    filipino: '菲律宾语',
    swedish: '瑞典语',
    vietnamese: '越南语',
    thai: '泰语',
    persian: '波斯语',
    farsi: '波斯语',
    hebrew: '希伯来语',
    danish: '丹麦语',
    finnish: '芬兰语',
    norwegian: '挪威语',
    bengali: '孟加拉语',
    bangla: '孟加拉语',
    malay: '马来语',
    urdu: '乌尔都语',
    catalan: '加泰罗尼亚语',
    lithuanian: '立陶宛语',
    latvian: '拉脱维亚语',
    estonian: '爱沙尼亚语',
    slovenian: '斯洛文尼亚语',
    albanian: '阿尔巴尼亚语',
    macedonian: '马其顿语',
    bosnian: '波斯尼亚语',
    swahili: '斯瓦希里语',
    icelandic: '冰岛语',
    punjabi: '旁遮普语',
    marathi: '马拉地语',
    telugu: '泰卢固语',
    gujarati: '古吉拉特语',
    kannada: '卡纳达语',
    malayalam: '马拉雅拉姆语',
    amharic: '阿姆哈拉语',
    georgian: '格鲁吉亚语',
    armenian: '亚美尼亚语',
    azerbaijani: '阿塞拜疆语',
    kazakh: '哈萨克语',
    uzbek: '乌兹别克语',
    mongolian: '蒙古语',
    tibetan: '藏语',
    uyghur: '维吾尔语',
    latin: '拉丁语',
    esperanto: '世界语',
    hokkien: '闽南语',
    flemish: '佛兰芒语',
    montenegro: '黑山语',
    luganda: '卢干达语',

    // 常见地域变体及拼写
    'american english': '美式英语',
    'british english': '英式英语',
    'english uk': '英式英语',
    'brazilian portuguese': '巴西葡萄牙语',
    'português (brasil)': '巴西葡萄牙语',
    'português brasil': '巴西葡萄牙语',
    'portugues do brasil': '巴西葡萄牙语',
    'português (br)': '巴西葡萄牙语',
    'español mexico': '墨西哥西班牙语',
    'español argentina': '阿根廷西班牙语',
    'español chile': '智利西班牙语',
    'español colombia': '哥伦比亚西班牙语',
    'español internacional': '国际西班牙语',
    'español - latinoamerica': '拉美西班牙语',
    'castellano. español': '西班牙语',
    castellano: '西班牙语',
    español: '西班牙语',
    espaňol: '西班牙语',
    espanish: '西班牙语',
    engilsh: '英语',
    deutsch: '德语',
    deutch: '德语',
    'deutsch fränkisch': '法兰克德语',
    francaise: '法语',
    français: '法语',
    'язык: русский': '俄语',
};

/**
 * 将国家代码或名称转换为中文
 * @param countryCode ISO-3166-1 两字母国家/地区代码（如 "US", "CN", "DE"）
 * @param fallbackName 原始备用名称（如 "The United States Of America"）
 */
export function formatCountryName(
    countryCode?: string | null,
    fallbackName?: string | null,
): string {
    const code = (countryCode ?? '').trim().toUpperCase();
    if (code && REGION_OVERRIDE_MAP[code]) {
        return REGION_OVERRIDE_MAP[code];
    }

    if (code && code.length === 2 && intlRegion) {
        try {
            const name = intlRegion.of(code);
            if (name && name !== code) {
                return name;
            }
        } catch {
            // 继续使用回退
        }
    }

    return fallbackName?.trim() || code;
}

/**
 * 将语言名称或 ISO 代码转换为中文
 * @param rawLanguage 原始语言字符串（如 "english", "spanish", "zh"）
 */
export function formatLanguageName(rawLanguage?: string | null): string {
    if (!rawLanguage) return '';
    const trimmed = rawLanguage.trim();
    if (!trimmed) return '';

    const lower = trimmed.toLowerCase();

    // 优先查字典
    if (LANGUAGE_CN_MAP[lower]) {
        return LANGUAGE_CN_MAP[lower];
    }

    // 支持逗号分隔的复合语言（如 "english, spanish"）
    if (lower.includes(',')) {
        return lower
            .split(',')
            .map((part) => formatLanguageName(part))
            .filter(Boolean)
            .join(' / ');
    }

    // 短代码尝试 Intl.DisplayNames (如 "en", "zh", "es", "yue")
    if (lower.length <= 3 && intlLang) {
        try {
            const zh = intlLang.of(lower);
            if (zh && zh !== lower) {
                return zh;
            }
        } catch {
            // 继续下文模糊匹配
        }
    }

    // 模糊前缀匹配 (如 "español ...")
    for (const [key, val] of Object.entries(LANGUAGE_CN_MAP)) {
        if (lower.startsWith(key) || lower.includes(key)) {
            return val;
        }
    }

    // 首字母大写回退
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
