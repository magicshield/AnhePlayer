import { useCallback, useRef, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { cn } from '@common/cn';
import { isRadioBrowserMedia } from '@common/radioBrowser';
import musicSheet, { useMusicIsFavorite, useRadioIsFavorite } from '@infra/musicSheet/renderer';
import type { IMusicItemSlim } from '@appTypes/infra/musicSheet';
import './index.scss';

/** FavoriteButton 尺寸预设 */
export type FavoriteButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface FavoriteButtonProps extends Omit<
    HTMLAttributes<HTMLButtonElement>,
    'onClick' | 'children'
> {
    /** 歌曲数据（完整或精简均可） */
    musicItem: IMusic.IMusicItem | IMusicItemSlim;
    /** 图标尺寸 */
    size?: FavoriteButtonSize;
}

/**
 * FavoriteButton — 业务组件
 *
 * 红心收藏按钮，根据歌曲是否在"我喜欢"歌单中切换图标与颜色。
 * 点击切换收藏 / 取消收藏。
 *
 * 设计稿还原（像素级）：
 *   容器: inline-flex, items-center, justify-center, rounded-pill
 *   默认: bg transparent, color text-secondary
 *   hover: bg fill-subtle-hover, color text-primary
 *   已收藏: color favorite（红色）
 *   active: opacity 0.6
 *   尺寸: sm(--icon-sm) md(--icon-md) lg(--icon-lg) xl(--icon-xl)
 */
export function FavoriteButton({
    musicItem,
    size = 'lg',
    className,
    ...rest
}: FavoriteButtonProps) {
    const { t } = useTranslation();
    const isRadio = isRadioBrowserMedia(musicItem);
    const isMusicFavorite = useMusicIsFavorite(musicItem);
    const isRadioFavorite = useRadioIsFavorite(musicItem);
    const isFavorite = isRadio ? isRadioFavorite : isMusicFavorite;
    const lockRef = useRef(false);

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (lockRef.current) return;
            lockRef.current = true;

            if (isRadio) {
                if (isFavorite) musicSheet.removeRadioFavorite(musicItem);
                else musicSheet.addRadioFavorite(musicItem);
            } else if (isFavorite) {
                musicSheet.removeMusicFromFavorite(musicItem);
            } else {
                musicSheet.addMusicToFavorite(musicItem);
            }

            setTimeout(() => {
                lockRef.current = false;
            }, 300);
        },
        [isFavorite, isRadio, musicItem],
    );

    return (
        <button
            type="button"
            className={cn(
                'favorite-btn',
                `favorite-btn--${size}`,
                isFavorite && 'is-active',
                className,
            )}
            aria-pressed={isFavorite}
            aria-label={
                isRadio
                    ? t(isFavorite ? 'radio.remove_favorite' : 'radio.add_favorite')
                    : t(isFavorite ? 'playlist.remove_from_favorites' : 'playlist.add_to_favorites')
            }
            onClick={handleClick}
            onDoubleClick={(e) => e.stopPropagation()}
            {...rest}
        >
            <Heart size="100%" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
    );
}

export default FavoriteButton;
