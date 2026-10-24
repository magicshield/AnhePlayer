import React, {
    useRef,
    useCallback,
    useEffect,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@common/cn';
import { RequestStatus } from '@common/constant';
import { Artwork } from '../Artwork';
import { ListFooter } from '../ListFooter';
import { StatusPlaceholder } from '../StatusPlaceholder';
import './index.scss';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface IMediaGridItem {
    id: string;
    title: string;
    artwork?: string;
    artist?: string;
    platform?: string;
}

export interface MediaGridProps<T extends IMediaGridItem = IMusic.IMusicSheetItem> {
    /** 数据列表（歌单 / 专辑 / 排行榜 / 电台等） */
    data: T[];
    /** 卡片点击 */
    onItemClick?: (item: T) => void;
    /** 卡片右键 */
    onItemContextMenu?: (item: T, e: ReactMouseEvent) => void;
    /** 播放按钮点击（传入后显示播放 FAB） */
    onPlayClick?: (item: T) => void;
    /** 自定义副标题 */
    getSubtitle?: (item: T) => string | undefined;

    // ── 加载状态 ──
    /** 请求状态 */
    requestStatus?: RequestStatus;
    /** 首次加载失败时的重试回调 */
    onRetry?: () => void;
    /** 错误态文案 */
    errorTitle?: string;
    /** 空态文案 */
    emptyTitle?: string;
    /** 空态图标 */
    emptyIcon?: LucideIcon;

    // ── 底部加载更多 ──
    /** 是否启用滚动加载更多 @default false */
    enableLoadMore?: boolean;
    /** 加载更多状态 */
    loadMoreStatus?: RequestStatus;
    /** 加载更多回调 */
    onLoadMore?: () => void;
    /** 加载更多重试 */
    onLoadMoreRetry?: () => void;

    /** 封面占位图标 */
    placeholderIcon?: ReactNode;
    /** 额外 className */
    className?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// MediaGrid — 主组件
// ────────────────────────────────────────────────────────────────────────────

/** 响应式媒体卡片网格。 */
export function MediaGrid<T extends IMediaGridItem = IMusic.IMusicSheetItem>({
    data,
    onItemClick,
    onItemContextMenu,
    onPlayClick,
    getSubtitle,
    requestStatus,
    onRetry,
    errorTitle,
    emptyTitle,
    emptyIcon,
    enableLoadMore = false,
    loadMoreStatus,
    onLoadMore,
    onLoadMoreRetry,
    placeholderIcon,
    className,
}: MediaGridProps<T>) {
    const { t } = useTranslation();
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!enableLoadMore || !onLoadMore) return;
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && loadMoreStatus !== RequestStatus.Pending) {
                    onLoadMore();
                }
            },
            { rootMargin: '200px' },
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [enableLoadMore, onLoadMore, loadMoreStatus]);

    if (data.length === 0) {
        if (requestStatus === RequestStatus.Pending) {
            return <StatusPlaceholder status={RequestStatus.Pending} />;
        }
        if (requestStatus === RequestStatus.Error) {
            return (
                <StatusPlaceholder
                    status={RequestStatus.Error}
                    errorTitle={errorTitle}
                    onRetry={onRetry}
                />
            );
        }
        if (
            !requestStatus ||
            requestStatus === RequestStatus.Done ||
            requestStatus === RequestStatus.Idle
        ) {
            return (
                <StatusPlaceholder
                    status={RequestStatus.Done}
                    isEmpty
                    emptyIcon={emptyIcon}
                    emptyTitle={emptyTitle ?? t('status.empty')}
                />
            );
        }
    }

    return (
        <div className={cn('media-grid', className)}>
            <div className="media-grid__grid">
                {data.map((item) => (
                    <MediaCard
                        key={`${item.platform ?? ''}\0${item.id}`}
                        item={item}
                        subtitle={getSubtitle?.(item) ?? item.artist}
                        playLabel={t('playback.play_item', { title: item.title })}
                        onItemClick={onItemClick}
                        onItemContextMenu={onItemContextMenu}
                        onPlayClick={onPlayClick}
                        placeholderIcon={placeholderIcon}
                    />
                ))}
            </div>

            {enableLoadMore && <div ref={sentinelRef} className="media-grid__sentinel" />}
            {enableLoadMore && (
                <ListFooter
                    status={loadMoreStatus ?? RequestStatus.Done}
                    onRetry={onLoadMoreRetry}
                />
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// MediaCard — 单张卡片
// ────────────────────────────────────────────────────────────────────────────

interface MediaCardProps<T extends IMediaGridItem> {
    item: T;
    subtitle?: string;
    playLabel: string;
    onItemClick?: (item: T) => void;
    onItemContextMenu?: (item: T, e: ReactMouseEvent) => void;
    onPlayClick?: (item: T) => void;
    placeholderIcon?: ReactNode;
}

function MediaCardInner<T extends IMediaGridItem>({
    item,
    subtitle,
    playLabel,
    onItemClick,
    onItemContextMenu,
    onPlayClick,
    placeholderIcon,
}: MediaCardProps<T>) {
    const handleClick = useCallback(() => {
        onItemClick?.(item);
    }, [item, onItemClick]);

    const handleContextMenu = useCallback(
        (e: ReactMouseEvent) => {
            onItemContextMenu?.(item, e);
        },
        [item, onItemContextMenu],
    );

    const handlePlayClick = useCallback(
        (e: ReactMouseEvent) => {
            e.stopPropagation();
            onPlayClick?.(item);
        },
        [item, onPlayClick],
    );

    return (
        <div className="media-card" onClick={handleClick} onContextMenu={handleContextMenu}>
            <div className="media-card__cover-wrapper">
                <Artwork
                    src={item.artwork}
                    alt={item.title}
                    rounded="sm"
                    size="auto"
                    fallback={placeholderIcon}
                    className="media-card__cover"
                />

                {onPlayClick && (
                    <button
                        type="button"
                        className="media-card__play-fab"
                        onClick={handlePlayClick}
                        aria-label={playLabel}
                    >
                        <Play size={18} fill="currentColor" />
                    </button>
                )}
            </div>

            <div className="media-card__info">
                <div className="media-card__title" title={item.title}>
                    {item.title}
                </div>
                {subtitle && (
                    <div className="media-card__subtitle" title={subtitle}>
                        {subtitle}
                    </div>
                )}
            </div>
        </div>
    );
}

const MediaCard = React.memo(MediaCardInner) as typeof MediaCardInner;

export default MediaGrid;
