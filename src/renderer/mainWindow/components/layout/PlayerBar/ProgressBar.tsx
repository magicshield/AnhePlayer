// ============================================================================
// ProgressBar — 进度条 + 时间显示（独立订阅 progressAtom，隔离高频更新）
// ============================================================================

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentMusic, useProgress } from '@renderer/mainWindow/core/trackPlayer/hooks';
import { isRadioBrowserMedia } from '@common/radioBrowser';
import { ProgressBar as UIProgressBar } from '../../ui/ProgressBar';
import { useProgressDrag } from '@renderer/mainWindow/hooks/useProgressDrag';
import formatDuration from '@common/formatDuration';

// ─── ProgressBar ───

/**
 * 进度条。独立为子组件，隔离高频 timeUpdate → progressAtom 变化，
 * 避免每秒多次触发整个 PlayerBar 重渲染。
 */
const ProgressBar = memo(function ProgressBar() {
    const currentMusic = useCurrentMusic();
    const progress = useProgress();
    const isLive = isRadioBrowserMedia(currentMusic);
    const { displayValue, handleChange, handleDragStart, handleDragEnd } =
        useProgressDrag(progress);

    return (
        <UIProgressBar
            className="l-player-bar__progress"
            value={isLive ? 0 : displayValue}
            variant="slim"
            interactive={!isLive}
            onChange={handleChange}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        />
    );
});

// ─── TimeDisplay ───

/**
 * 时间显示，同样隔离高频 progressAtom 更新。
 */
const TimeDisplay = memo(function TimeDisplay() {
    const { t } = useTranslation();
    const currentMusic = useCurrentMusic();
    const progress = useProgress();
    return (
        <span className="l-player-bar__time">
            {isRadioBrowserMedia(currentMusic)
                ? t('radio.live')
                : `${formatDuration(progress.currentTime)} / ${formatDuration(progress.duration)}`}
        </span>
    );
});

export { ProgressBar, TimeDisplay };
