/**
 * shortCut — 渲染进程层
 *
 * 职责:
 *  1. 管理应用内（local）快捷键 — 基于 tinykeys 监听 DOM keydown
 *  2. 热更新：监听 appConfig 变更，自动重新绑定
 *  3. 快捷键触发时通过 appSync.sendCommand 派发指令
 *
 * NOTE:
 *  - 本模块仅处理配置化的 8 个 ShortCutAction
 *  - 组件级临时快捷键（如 Esc 关闭弹窗、Shift 多选）
 *    建议直接在组件中使用 tinykeys 绑定到特定 DOM 元素
 */
import { tinykeys } from 'tinykeys';
import type { IAppConfig, IAppConfigReader } from '@appTypes/infra/appConfig';
import type { ICommandSender } from '@appTypes/infra/appSync';
import type { IShortCutBinding, ShortCutAction } from '@appTypes/infra/shortCut';
import { acceleratorToTinykeys } from './common/accelerator';

// ─── 模块实现 ───

class ShortCutRenderer {
    private appConfig!: IAppConfigReader;
    private appSync!: ICommandSender;

    /** tinykeys 返回的取消绑定函数 */
    private unsubscribeLocal: (() => void) | null = null;

    private isSetup = false;

    /**
     * 初始化，需在 appConfig 和 appSync renderer 层 setup 之后调用。
     */
    public setup(deps: { appConfig: IAppConfigReader; appSync: ICommandSender }) {
        if (this.isSetup) {
            return;
        }

        this.appConfig = deps.appConfig;
        this.appSync = deps.appSync;

        // 初次绑定 local 快捷键
        this.applyLocalShortcuts();

        // 监听配置变更，热更新
        this.appConfig.onConfigUpdated(this.handleConfigUpdated);

        this.isSetup = true;
    }

    // ─── 内部逻辑 ───

    private handleConfigUpdated = (patch: IAppConfig) => {
        const relevantKeys: string[] = ['shortCut.enableLocal', 'shortCut.shortcuts'];

        const hasRelevantChange = relevantKeys.some(
            (key) => key in (patch as Record<string, unknown>),
        );
        if (hasRelevantChange) {
            this.applyLocalShortcuts();
        }
    };

    /**
     * 根据当前配置绑定本地快捷键。
     * 先取消旧绑定，再全量重新绑定。
     */
    private applyLocalShortcuts() {
        // 取消之前的绑定
        this.unsubscribeLocal?.();
        this.unsubscribeLocal = null;

        const enableLocal = this.appConfig.getConfigByKey('shortCut.enableLocal');
        if (!enableLocal) {
            return;
        }

        const shortcutsMap = this.appConfig.getConfigByKey('shortCut.shortcuts');
        if (!shortcutsMap) {
            return;
        }

        const keyBindings: Record<string, (event: KeyboardEvent) => void> = {};

        const actions = Object.keys(shortcutsMap) as ShortCutAction[];
        for (const action of actions) {
            const binding: IShortCutBinding | undefined = shortcutsMap[action];
            if (!binding?.local?.length) {
                continue;
            }

            const accelerator = binding.local.join('+');
            if (!accelerator) {
                continue;
            }

            const tinykeysCombination = acceleratorToTinykeys(accelerator);
            keyBindings[tinykeysCombination] = (event) => {
                // 当焦点在输入型元素时，不拦截快捷键，避免阻止正常输入（如空格）
                const target = event.target as HTMLElement | null;
                if (target) {
                    const tagName = target.tagName;
                    if (
                        tagName === 'INPUT' ||
                        tagName === 'TEXTAREA' ||
                        tagName === 'SELECT' ||
                        target.isContentEditable
                    ) {
                        return;
                    }
                }
                event.preventDefault();
                this.appSync.sendCommand(action);
            };
        }

        if (Object.keys(keyBindings).length > 0) {
            this.unsubscribeLocal = tinykeys(window, keyBindings);
        }
    }
}

const shortCutRenderer = new ShortCutRenderer();
export default shortCutRenderer;
