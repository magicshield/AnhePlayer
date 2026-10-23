/**
 * ShortCut — 快捷键模块类型定义
 *
 * 管理应用内键盘快捷键的注册与派发。
 * 快捷键触发时通过 appSync 的 ICommand 机制派发指令到主窗口。
 */

// ─── 核心类型 ───

/**
 * 所有可绑定快捷键的动作名称。
 * 每个动作必须同时在 ICommand 中注册（通过 declaration merging）。
 */
export type ShortCutAction =
    | 'play/pause'
    | 'skip-previous'
    | 'skip-next'
    | 'toggle-desktop-lyric'
    | 'volume-up'
    | 'volume-down'
    | 'like/dislike'
    | 'toggle-minimode';

/**
 * 单个动作的快捷键绑定配置。
 * 快捷键保留既有应用配置格式。
 *
 * `string[]` 表示一个组合键的各个按键部分，如 `["CmdOrCtrl", "Shift", "P"]`。
 * 使用时通过 `join('+')` 拼接为完整的 Accelerator 字符串。
 *
 */
export interface IShortCutBinding {
    /** 应用内快捷键的按键部分，如 ["CmdOrCtrl", "Shift", "P"] */
    local?: string[] | null;
}

/** 完整的快捷键映射表 */
export type IShortCutMap = Record<ShortCutAction, IShortCutBinding>;
