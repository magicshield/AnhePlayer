/**
 * 辅助窗口（歌词 / 迷你模式）Renderer 初始化
 *
 * 按依赖顺序 setup 辅助窗口需要的 infra 模块。
 *
 * 初始化顺序:
 *   1. appConfig（最先）
 *   2. i18n
 */
import './global.scss';

import appConfig from '@infra/appConfig/renderer';
import i18n from '@infra/i18n/renderer';

export default async function bootstrapAuxiliaryWindow(): Promise<void> {
    // Phase 1: appConfig 必须最先初始化
    await appConfig.setup();

    // Phase 2: 无相互依赖的模块并行初始化
    await Promise.all([i18n.setup()]);
}
