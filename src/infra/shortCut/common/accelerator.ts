/**
 * 将应用保存的快捷键格式转换为 tinykeys 格式
 *
 * 旧版配置格式: "CmdOrCtrl+Shift+P", "Alt+F4", "MediaPlayPause"
 * tinykeys 格式: "$mod+Shift+p", "Alt+F4", "MediaPlayPause"
 *
 * @see https://github.com/jamiebuilds/tinykeys
 */

/**
 * 修饰键映射表：配置格式 → tinykeys modifier
 *
 * 配置格式不区分大小写，这里统一按小写 key 匹配。
 * tinykeys 使用 KeyboardEvent.getModifierState() 的标准名称。
 */
const MODIFIER_MAP: Record<string, string> = {
    // Ctrl / Control
    ctrl: 'Control',
    control: 'Control',

    // Alt / Option
    alt: 'Alt',
    option: 'Alt',

    // Shift
    shift: 'Shift',

    // Meta / Command / Super
    meta: 'Meta',
    cmd: 'Meta',
    command: 'Meta',
    super: 'Meta',

    // 特殊：跨平台修饰键
    cmdorctrl: '$mod',
    commandorcontrol: '$mod',
};

/**
 * 特殊键名映射表：配置键名 → tinykeys 键名
 *
 * 配置使用旧版按键命名（如 "Return"），
 * tinykeys 使用 KeyboardEvent.key 或 KeyboardEvent.code 标准名称。
 */
const KEY_MAP: Record<string, string> = {
    // 导航键
    return: 'Enter',
    enter: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape',
    space: 'Space',

    // 方向键
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',

    // 翻页
    pageup: 'PageUp',
    pagedown: 'PageDown',
    home: 'Home',
    end: 'End',

    // 功能键（保留原名，KeyboardEvent.key 使用相同格式）
    // F1-F24 不需要映射，直接保留

    // 媒体键
    mediaplaypause: 'MediaPlayPause',
    mediastop: 'MediaStop',
    medianexttrack: 'MediaTrackNext',
    mediaprevioustrack: 'MediaTrackPrevious',
    volumeup: 'AudioVolumeUp',
    volumedown: 'AudioVolumeDown',
    volumemute: 'AudioVolumeMute',

    // 符号键
    plus: '+',
    numadd: '+',
    numsub: '-',
    numdec: '.',
    nummult: '*',
    numdiv: '/',
};

/**
 * 将应用配置中的快捷键字符串转换为 tinykeys 格式。
 *
 * @param accelerator 快捷键格式字符串，如 "CmdOrCtrl+Shift+P"
 * @returns tinykeys 格式字符串，如 "$mod+Shift+p"
 *
 * @example
 * ```ts
 * acceleratorToTinykeys("CmdOrCtrl+Shift+P")  // → "$mod+Shift+p"
 * acceleratorToTinykeys("Alt+F4")             // → "Alt+F4"
 * acceleratorToTinykeys("Ctrl+A")             // → "Control+a"
 * acceleratorToTinykeys("MediaPlayPause")     // → "MediaPlayPause"
 * ```
 */
export function acceleratorToTinykeys(accelerator: string): string {
    // 兼容旧配置：空格键可能存储为 ' ' 而非 'Space'，
    // split('+') + trim() 会丢失它。先统一替换为 'Space'。
    const sanitized = accelerator.replace(/ /g, 'Space');
    const parts = sanitized
        .split('+')
        .map((p) => p.trim())
        .filter(Boolean);

    const modifiers: string[] = [];
    let key = '';

    for (const part of parts) {
        const lower = part.toLowerCase();
        const modifier = MODIFIER_MAP[lower];

        if (modifier) {
            modifiers.push(modifier);
        } else {
            // 非修饰键：尝试映射特殊键名，否则保持原值
            key = KEY_MAP[lower] ?? part;
        }
    }

    // 对于纯字母键（单个字符），tinykeys 匹配 event.key，需要小写
    // 对于特殊键（如 F4, ArrowUp），保持原样
    if (key.length === 1 && /^[A-Za-z]$/.test(key)) {
        key = key.toLowerCase();
    }

    // 拼接：modifiers + key
    const allParts = [...modifiers, key].filter(Boolean);
    return allParts.join('+');
}
