// ============================================================================
// FullscreenPlayer — 状态管理
// ============================================================================
//
// 与 QueueDrawer 同构的 jotai atom + 命令式 API 模式：
//   atom 定义状态 → getDefaultStore().set() → 导出命令式函数 → 组件 useAtomValue 订阅
//

import { atom, getDefaultStore } from 'jotai';

// ────────────────────────────────────────────────────────────────────────────
// Atom
// ────────────────────────────────────────────────────────────────────────────

export const fullscreenPlayerOpenAtom = atom(false);

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

const store = getDefaultStore();

/** 关闭全屏播放器 */
export function closeFullscreenPlayer(): void {
    store.set(fullscreenPlayerOpenAtom, false);
}

/** 打开全屏播放器 */
export function openFullscreenPlayer(): void {
    store.set(fullscreenPlayerOpenAtom, true);
}
