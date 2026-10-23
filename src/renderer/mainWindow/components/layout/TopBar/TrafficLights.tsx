/**
 * TrafficLights — macOS 风格窗口控件（红/黄/绿）
 *
 * Windows 风格的「最小化/最大化/关闭」方块按钮在 macOS 上与系统观感不符，
 * 这里在 darwin 宿主下改为原生交通灯样式：圆点、悬停显示符号、置于左上角。
 * 非 macOS 宿主返回 null，由 TopBar 原有的窗口按钮接管。
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import systemUtil from '@infra/systemUtil/renderer';
import appConfig from '@infra/appConfig/renderer';
import { hostPlatform } from '@infra/tauriBridge/hostPlatform';

export default function TrafficLights() {
    const { t } = useTranslation();

    const handleClose = useCallback(() => {
        if (appConfig.getConfigByKey('normal.closeBehavior') === 'exit_app') {
            systemUtil.exitApp();
        } else {
            systemUtil.minimizeWindow(true);
        }
    }, []);

    const handleMinimize = useCallback(() => {
        systemUtil.minimizeWindow();
    }, []);

    const handleZoom = useCallback(() => {
        systemUtil.toggleMaximize();
    }, []);

    if (hostPlatform() !== 'darwin') {
        return null;
    }

    return (
        <div className="l-topbar__traffic" data-no-drag>
            <button
                type="button"
                className="l-topbar__traffic-dot l-topbar__traffic-dot--close"
                title={t('common.close')}
                aria-label={t('common.close')}
                onClick={handleClose}
            >
                <span aria-hidden="true">&#215;</span>
            </button>
            <button
                type="button"
                className="l-topbar__traffic-dot l-topbar__traffic-dot--min"
                title={t('app.minimize')}
                aria-label={t('app.minimize')}
                onClick={handleMinimize}
            >
                <span aria-hidden="true">&#8722;</span>
            </button>
            <button
                type="button"
                className="l-topbar__traffic-dot l-topbar__traffic-dot--zoom"
                title={t('app.maximize')}
                aria-label={t('app.maximize')}
                onClick={handleZoom}
            >
                <span aria-hidden="true">&#43;</span>
            </button>
        </div>
    );
}
