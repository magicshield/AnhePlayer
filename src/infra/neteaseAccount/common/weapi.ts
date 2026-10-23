/**
 * 网易云 WeAPI 请求加密
 *
 * 只依赖 WebCrypto（AES-CBC）与 BigInt，Node 22 与 WebView2 均原生支持。
 * 网易云的 RSA 是无填充的裸模幂运算，WebCrypto 不提供该模式，因此用 BigInt 手工计算。
 */

const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// 网易云官方 1024 位 RSA 公钥（与 PEM 公钥等价，指数 0x10001）
const RSA_MODULUS = BigInt(
    '0xe0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7',
);
const RSA_EXPONENT = BigInt(0x10001);

const textEncoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    const zero = BigInt(0);
    const one = BigInt(1);
    let result = one;
    let b = base % modulus;
    let e = exponent;
    while (e > zero) {
        if ((e & one) === one) result = (result * b) % modulus;
        e >>= one;
        b = (b * b) % modulus;
    }
    return result;
}

async function aesCbcBase64(plain: string, key: string): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(key),
        { name: 'AES-CBC' },
        false,
        ['encrypt'],
    );
    // WebCrypto 的 AES-CBC 固定使用 PKCS#7 填充，与 Node 的 aes-128-cbc 默认行为一致
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: textEncoder.encode(IV) },
        cryptoKey,
        textEncoder.encode(plain),
    );
    return bytesToBase64(new Uint8Array(encrypted));
}

/** 无填充 RSA：密钥字节逆序后按大端整数做模幂，输出定长 256 位十六进制 */
function rsaNoPaddingHex(secretKey: string): string {
    const reversed = Array.from(textEncoder.encode(secretKey)).reverse();
    const hex = reversed.map((b) => b.toString(16).padStart(2, '0')).join('');
    return modPow(BigInt(`0x${hex}`), RSA_EXPONENT, RSA_MODULUS)
        .toString(16)
        .padStart(256, '0');
}

function randomSecretKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => BASE62[b % BASE62.length]).join('');
}

/** 用指定 secretKey 加密，便于对拍验证；业务代码请用 buildWeapiBody */
export async function encryptWeapi(
    data: Record<string, unknown>,
    secretKey: string,
): Promise<{ params: string; encSecKey: string }> {
    const firstPass = await aesCbcBase64(JSON.stringify(data), PRESET_KEY);
    const params = await aesCbcBase64(firstPass, secretKey);
    return { params, encSecKey: rsaNoPaddingHex(secretKey) };
}

/** 构建 application/x-www-form-urlencoded 请求体 */
export async function buildWeapiBody(data: Record<string, unknown>): Promise<string> {
    const { params, encSecKey } = await encryptWeapi(data, randomSecretKey());
    return new URLSearchParams({ params, encSecKey }).toString();
}
