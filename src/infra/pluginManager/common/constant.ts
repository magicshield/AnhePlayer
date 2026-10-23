/**
 * pluginManager — 常量定义
 *
 * 插件目录及 bridge 标识。
 */

// ─── 路径常量 ───

/** 插件 JS 文件存储目录名 */
export const PLUGIN_DIR_NAME = 'anhe-player-plugins';

/** 插件缓存文件名（用于首帧渲染） */
export const PLUGIN_CACHE_FILE_NAME = '.plugin-cache.json';

/** 插件 meta 文件名（排序、用户变量等） */
export const PLUGIN_META_FILE_NAME = '.plugin-meta.json';

// ─── 其他常量 ───

/** Tauri bridge key */
export const CONTEXT_BRIDGE_KEY = '@infra/plugin-manager';
