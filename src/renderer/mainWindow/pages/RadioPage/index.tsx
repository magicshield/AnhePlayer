import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import {
    AlertTriangle,
    ArrowLeft,
    Bookmark,
    ChevronLeft,
    ChevronRight,
    Globe2,
    Lock,
    Maximize2,
    Minimize2,
    Minus,
    Pause,
    Play,
    Radio,
    Search,
    SkipBack,
    SkipForward,
    SlidersHorizontal,
    Sparkles,
    Square,
    RotateCcw,
    Unlock,
    Volume1,
    Volume2,
    VolumeX,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RequestStatus } from '@common/constant';
import { compositeKey } from '@common/mediaKey';
import {
    RADIO_BROWSER_PLATFORM,
    RADIO_BROWSER_WEBSITE,
    type IRadioBrowserMusicItem,
} from '@common/radioBrowser';
import type { IRadioStationFilters } from '@infra/radioBrowser/renderer';
import systemUtil from '@infra/systemUtil/renderer';
import appConfig from '@infra/appConfig/renderer';
import musicSheet, { useRadioFavorites, useRadioIsFavorite } from '@infra/musicSheet/renderer';
import { useCurrentThemePack } from '@infra/themepack/renderer';
import { RoutePaths } from '../../routes';
import { A } from '../../components/ui/A';
import RadioScene, { type IRadioSceneHandle } from './components/RadioScene';
import {
    radioAudioPlayer,
    useRadioCurrentStation,
    useRadioPlaybackState,
    useRadioVolume,
} from './services/radioAudioPlayer';
import {
    buildRadioSceneNodes,
    type RadioGenreFamily,
    type RadioSceneLayout,
} from './data/sceneLayout';
import { useRadioExplorer, useRadioSearch } from './useRadioExplorer';
import { formatCountryName, formatLanguageName } from './utils/geoLanguageMap';
import './index.scss';

const GENRE_FILTERS: Array<{ label: RadioGenreFamily | '全部'; tag: string }> = [
    { label: '全部', tag: '' },
    { label: '综合', tag: 'mixed' },
    { label: '流行', tag: 'pop' },
    { label: '新闻谈话', tag: 'news' },
    { label: '摇滚', tag: 'rock' },
    { label: '电子', tag: 'electronic' },
    { label: '地方与世界', tag: 'world' },
    { label: '宗教', tag: 'religious' },
    { label: '古典', tag: 'classical' },
    { label: '爵士蓝调', tag: 'jazz' },
    { label: '乡村民谣', tag: 'country' },
    { label: '嘻哈', tag: 'hip hop' },
];

interface IBitrateFilter {
    key: string;
    label: string;
    min?: number;
    max?: number;
}

const BITRATE_FILTERS: IBitrateFilter[] = [
    { key: 'all', label: '全部', min: undefined, max: undefined },
    { key: '128', label: '≥ 128 kbps', min: 128, max: undefined },
    { key: '192', label: '≥ 192 kbps', min: 192, max: undefined },
    { key: '320', label: '320 kbps', min: 320, max: 320 },
] as const;

type TuningState = 'idle' | 'interacting' | 'settling' | 'locked' | 'buffering' | 'error';

function stationKey(station: Pick<IRadioBrowserMusicItem, 'platform' | 'id'>): string {
    return compositeKey(station.platform, String(station.id));
}

export default function RadioPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const radioStation = useRadioCurrentStation();
    const radioState = useRadioPlaybackState();
    const currentTheme = useCurrentThemePack();
    const favorites = useRadioFavorites();
    const volume = useRadioVolume();
    const prevVolumeRef = useRef(1);
    const sceneRef = useRef<IRadioSceneHandle>(null);
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tuneGenerationRef = useRef(0);
    const lastTuneAtRef = useRef(0);

    const [layout, setLayout] = useState<RadioSceneLayout>('globe');
    const [filters, setFilters] = useState<IRadioStationFilters>({});
    const [bitrateKey, setBitrateKey] = useState('all');
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [injectedStation, setInjectedStation] = useState<IRadioBrowserMusicItem | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [favoritesOpen, setFavoritesOpen] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [locked, setLocked] = useState(false);
    const [tuningState, setTuningState] = useState<TuningState>('idle');
    const [webglLost, setWebglLost] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);
    const [tuningOverlay, setTuningOverlay] = useState<{
        genre: string;
        stationName: string;
        freq: string;
    } | null>(null);
    const tuningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { stations, facets, status, facetsStatus, retry, retryFacets } =
        useRadioExplorer(filters);
    const { results: searchResults, status: searchStatus } = useRadioSearch(
        searchQuery,
        searchOpen,
    );

    const allStations = useMemo(() => {
        if (
            !injectedStation ||
            stations.some((station) => stationKey(station) === stationKey(injectedStation))
        ) {
            return stations;
        }
        return [...stations.slice(0, 1199), injectedStation];
    }, [injectedStation, stations]);
    const nodes = useMemo(() => buildRadioSceneNodes(allStations), [allStations]);
    const nodeByKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
    const tagCounts = useMemo(
        () => new Map(facets.tags.map((tag) => [tag.value.toLowerCase(), tag.count] as const)),
        [facets.tags],
    );

    const sortedCountries = useMemo(() => {
        const list = [...facets.countries];
        const cnIndex = list.findIndex((c) => c.value.toUpperCase() === 'CN');
        if (cnIndex > 0) {
            const [cn] = list.splice(cnIndex, 1);
            list.unshift(cn);
        }
        return list;
    }, [facets.countries]);

    const sortedLanguages = useMemo(() => {
        const list = [...facets.languages];
        const zhIndex = list.findIndex(
            (l) => l.value.toLowerCase() === 'chinese' || l.value.toLowerCase() === 'zh',
        );
        if (zhIndex > 0) {
            const [zh] = list.splice(zhIndex, 1);
            list.unshift(zh);
        }
        return list;
    }, [facets.languages]);

    const chipsRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const checkScrollBounds = useCallback(() => {
        const el = chipsRef.current;
        if (!el) return;
        const { scrollLeft, scrollWidth, clientWidth } = el;
        setCanScrollLeft(scrollLeft > 2);
        setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
    }, []);

    const handleScrollChips = useCallback((direction: 'left' | 'right') => {
        const el = chipsRef.current;
        if (!el) return;
        const scrollAmount = Math.max(160, Math.floor(el.clientWidth * 0.6));
        el.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth',
        });
    }, []);

    useEffect(() => {
        const el = chipsRef.current;
        if (!el) return;

        const handleWheel = (event: WheelEvent) => {
            if (event.deltaY !== 0 && el.scrollWidth > el.clientWidth) {
                event.preventDefault();
                el.scrollLeft += event.deltaY;
                checkScrollBounds();
            }
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('resize', checkScrollBounds);
        checkScrollBounds();
        const timer = setTimeout(checkScrollBounds, 300);

        return () => {
            el.removeEventListener('wheel', handleWheel);
            window.removeEventListener('resize', checkScrollBounds);
            clearTimeout(timer);
        };
    }, [checkScrollBounds]);

    useEffect(() => {
        checkScrollBounds();
    }, [nodes.length, checkScrollBounds]);
    const playingKey = radioStation
        ? compositeKey(radioStation.platform, String(radioStation.id))
        : null;
    const selectedStation = selectedKey ? (nodeByKey.get(selectedKey)?.station ?? null) : null;
    const hoveredStation = hoveredKey ? (nodeByKey.get(hoveredKey)?.station ?? null) : null;
    const selectedFavorite = useRadioIsFavorite(
        selectedStation ?? { platform: RADIO_BROWSER_PLATFORM, id: '' },
    );
    const isPlaying = radioState === 'playing';

    const VolumeIcon = volume === 0 ? VolumeX : volume < 0.4 ? Volume1 : Volume2;

    const handleExit = useCallback(() => {
        radioAudioPlayer.stop();
        if (typeof navigation !== 'undefined' && (navigation as any).canGoBack) {
            window.history.back();
        } else if (window.history.state && window.history.state.idx > 0) {
            navigate(-1);
        } else {
            navigate(`/${RoutePaths.RecommendSheets}`);
        }
    }, [navigate]);

    // 退出电台页面时停止播放并释放音频资源
    useEffect(() => {
        return () => {
            radioAudioPlayer.stop();
            if (tuningTimerRef.current) clearTimeout(tuningTimerRef.current);
        };
    }, []);

    const handleMinimize = useCallback(() => {
        systemUtil.minimizeWindow();
    }, []);

    const handleMaximize = useCallback(() => {
        systemUtil.toggleMaximize();
    }, []);

    const handleClose = useCallback(() => {
        if (appConfig.getConfigByKey('normal.closeBehavior') === 'exit_app') {
            systemUtil.exitApp();
        } else {
            systemUtil.minimizeWindow(true);
        }
    }, []);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen?.();
            } else {
                await document.exitFullscreen?.();
            }
        } catch {
            // ignore if unsupported
        }
    }, []);

    const toggleMute = useCallback(() => {
        if (volume === 0) {
            radioAudioPlayer.setVolume(prevVolumeRef.current || 1);
        } else {
            prevVolumeRef.current = volume;
            radioAudioPlayer.setVolume(0);
        }
    }, [volume]);

    useEffect(() => {
        const handler = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    useEffect(() => {
        if (selectedKey && nodeByKey.has(selectedKey)) return;
        if (playingKey && nodeByKey.has(playingKey)) {
            setSelectedKey(playingKey);
            return;
        }
        const first = nodes[0];
        if (first) setSelectedKey(first.key);
    }, [nodeByKey, nodes, playingKey, selectedKey]);

    useEffect(() => {
        sceneRef.current?.updateTheme();
    }, [currentTheme]);

    useEffect(() => {
        return () => {
            if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
            tuneGenerationRef.current++;
        };
    }, []);

    useEffect(() => {
        if (!locked && !searchOpen && !favoritesOpen && !filtersOpen) return;
        if (settleTimerRef.current) {
            clearTimeout(settleTimerRef.current);
            settleTimerRef.current = null;
        }
        setTuningState(locked ? 'locked' : 'idle');
    }, [favoritesOpen, filtersOpen, locked, searchOpen]);

    useEffect(() => {
        if (settleTimerRef.current) {
            clearTimeout(settleTimerRef.current);
            settleTimerRef.current = null;
        }
        setTuningState(locked ? 'locked' : 'idle');
    }, [filters, locked]);

    const tuneStation = useCallback(
        async (station: IRadioBrowserMusicItem, automatic = false) => {
            const key = stationKey(station);
            if (automatic && playingKey === key && isPlaying) {
                setTuningState(locked ? 'locked' : 'idle');
                return;
            }
            const generation = ++tuneGenerationRef.current;
            setTuningState('buffering');
            try {
                await radioAudioPlayer.play(station);
                if (generation !== tuneGenerationRef.current) return;
                lastTuneAtRef.current = Date.now();
                setTuningState(locked ? 'locked' : 'idle');
            } catch {
                if (generation === tuneGenerationRef.current) setTuningState('error');
            }
        },
        [isPlaying, locked, playingKey],
    );

    const focusStation = useCallback(
        (station: IRadioBrowserMusicItem) => {
            const key = stationKey(station);
            if (!nodeByKey.has(key)) setInjectedStation(station);
            setSelectedKey(key);
            requestAnimationFrame(() => sceneRef.current?.focusNode(key));
        },
        [nodeByKey],
    );

    const handleInteractionStart = useCallback(() => {
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        setTuningState(locked ? 'locked' : 'interacting');
    }, [locked]);

    const handleInteractionEnd = useCallback(
        (centerKey: string | null) => {
            if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
            if (!centerKey || locked || searchOpen || favoritesOpen || filtersOpen) {
                setTuningState(locked ? 'locked' : 'idle');
                return;
            }
            setSelectedKey(centerKey);
            setTuningState('settling');
            const scheduledKey = centerKey;
            settleTimerRef.current = setTimeout(() => {
                const finalKey = sceneRef.current?.getCenterKey() ?? scheduledKey;
                const station = nodeByKey.get(finalKey)?.station;
                if (!station || locked || document.hidden) return;
                setSelectedKey(finalKey);
                const remaining = 1200 - (Date.now() - lastTuneAtRef.current);
                if (remaining > 0) {
                    settleTimerRef.current = setTimeout(
                        () => tuneStation(station, true),
                        remaining,
                    );
                } else {
                    tuneStation(station, true);
                }
            }, 700);
        },
        [favoritesOpen, filtersOpen, locked, nodeByKey, searchOpen, tuneStation],
    );

    const handlePlayClick = useCallback(() => {
        if (!selectedStation) return;
        const key = stationKey(selectedStation);
        if (key === playingKey) {
            radioAudioPlayer.togglePlayPause();
        } else {
            tuneStation(selectedStation);
        }
    }, [playingKey, selectedStation, tuneStation]);

    const moveSelection = useCallback(
        (direction: -1 | 1, play = false) => {
            if (nodes.length === 0) return;
            const currentIndex = Math.max(
                0,
                nodes.findIndex((node) => node.key === selectedKey),
            );
            const nextNode = nodes[(currentIndex + direction + nodes.length) % nodes.length];
            setSelectedKey(nextNode.key);
            sceneRef.current?.focusNode(nextNode.key);
            if (play) tuneStation(nextNode.station);
        },
        [nodes, selectedKey, tuneStation],
    );

    const toggleFavorite = useCallback(() => {
        if (!selectedStation) return;
        if (selectedFavorite) musicSheet.removeRadioFavorite(selectedStation);
        else musicSheet.addRadioFavorite(selectedStation);
    }, [selectedFavorite, selectedStation]);

    const chooseExternalStation = useCallback(
        (station: IRadioBrowserMusicItem) => {
            focusStation(station);
            setSearchOpen(false);
            setFavoritesOpen(false);
            setSearchQuery('');
        },
        [focusStation],
    );

    const handleGenreChipClick = useCallback(
        async (genreItem: { label: RadioGenreFamily | '全部'; tag: string }) => {
            setFilters((current) => ({
                ...current,
                tag: genreItem.tag || undefined,
            }));

            if (genreItem.label === '全部') {
                sceneRef.current?.highlightGenreFamily(null);
                return;
            }

            const family = genreItem.label as RadioGenreFamily;

            // 1. 自动切换至流派星云视图以呈现星云联动
            if (layout !== 'genres') {
                setLayout('genres');
            }

            // 2. 镜头平滑飞行聚焦并高亮该流派簇
            sceneRef.current?.focusGenreFamily(family, true);
            sceneRef.current?.highlightGenreFamily(family);

            // 3. 从该流派星云粒子或候选池中随机挑选一个电台
            const matchedNodes = nodes.filter((node) => node.genreFamily === family);
            let candidateStations = matchedNodes.map((n) => n.station);

            if (candidateStations.length === 0 && genreItem.tag) {
                const tagLower = genreItem.tag.toLowerCase();
                candidateStations = allStations.filter((station) =>
                    station.radioBrowser.tags.some((tag) => tag.toLowerCase().includes(tagLower)),
                );
            }
            if (candidateStations.length === 0) {
                candidateStations = allStations;
            }
            if (candidateStations.length === 0) return;

            const randomIndex = Math.floor(Math.random() * candidateStations.length);
            const chosenStation = candidateStations[randomIndex];
            const chosenKey = compositeKey(chosenStation.platform, String(chosenStation.id));

            // 4. 定位选中该电台
            setSelectedKey(chosenKey);
            sceneRef.current?.focusNode(chosenKey, true);

            // 5. 启动极具未来感的量子调频 Loading 动效，随后自动播放
            setTuningOverlay({
                genre: family,
                stationName: chosenStation.title,
                freq: (87.5 + Math.random() * 20.5).toFixed(1),
            });

            if (tuningTimerRef.current) clearTimeout(tuningTimerRef.current);
            tuningTimerRef.current = setTimeout(async () => {
                try {
                    await tuneStation(chosenStation);
                } catch (error) {
                    console.error('Radio play error:', error);
                } finally {
                    setTuningOverlay(null);
                }
            }, 600);
        },
        [allStations, layout, nodes, tuneStation],
    );

    const setBitrateFilter = useCallback((key: string) => {
        const target = BITRATE_FILTERS.find((item) => item.key === key) ?? BITRATE_FILTERS[0];
        setBitrateKey(target.key);
        setFilters((current) => ({
            ...current,
            bitrateMin: target.min,
            bitrateMax: target.max,
        }));
    }, []);

    const hasActiveFilters = Boolean(
        filters.countryCode || filters.language || filters.tag || bitrateKey !== 'all',
    );

    const handleResetFilters = useCallback(() => {
        setBitrateKey('all');
        setFilters({});
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                target?.closest(
                    'input, textarea, select, button, a, [role="button"], [contenteditable="true"]',
                ) ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey
            ) {
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                if (searchOpen) {
                    setSearchOpen(false);
                    return;
                }
                if (favoritesOpen) {
                    setFavoritesOpen(false);
                    return;
                }
                if (filtersOpen) {
                    setFiltersOpen(false);
                    return;
                }
                handleExit();
                return;
            }
            if (event.key === '/') {
                event.preventDefault();
                setSearchOpen(true);
            } else if (event.key.toLowerCase() === 'g') {
                setLayout((current) => (current === 'globe' ? 'genres' : 'globe'));
            } else if (event.key.toLowerCase() === 'f') {
                toggleFavorite();
            } else if (event.key.toLowerCase() === 'l') {
                setLocked((current) => !current);
            } else if (event.key === ' ') {
                event.preventDefault();
                radioAudioPlayer.togglePlayPause();
            } else if (event.key === 'ArrowLeft') {
                moveSelection(-1, true);
            } else if (event.key === 'ArrowRight') {
                moveSelection(1, true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [favoritesOpen, filtersOpen, handleExit, moveSelection, searchOpen, toggleFavorite]);

    const tuningLabel = locked
        ? t('radio.tuning_locked')
        : tuningState === 'interacting'
          ? t('radio.tuning_browsing')
          : tuningState === 'settling'
            ? t('radio.tuning_settling')
            : tuningState === 'buffering'
              ? t('radio.tuning_buffering')
              : tuningState === 'error'
                ? t('radio.play_failed')
                : t('radio.tuning_ready');

    return (
        <div className="p-radio-explorer">
            <RadioScene
                ref={sceneRef}
                nodes={nodes}
                layout={layout}
                selectedKey={selectedKey}
                playingKey={playingKey}
                isLivePlaying={isPlaying}
                onHover={setHoveredKey}
                onSelect={(key) => setSelectedKey(key)}
                onInteractionStart={handleInteractionStart}
                onInteractionEnd={handleInteractionEnd}
                onContextLost={() => {
                    setWebglLost(true);
                    setTuningState('error');
                }}
                onContextRestored={() => setWebglLost(false)}
            />

            <header className="p-radio-explorer__topbar">
                <div className="p-radio-explorer__drag-region" data-tauri-drag-region />

                <div className="p-radio-explorer__top-left">
                    <button
                        className="p-radio-explorer__exit-btn"
                        type="button"
                        title={`${t('radio.exit')} (Esc)`}
                        aria-label={t('radio.exit')}
                        onClick={handleExit}
                    >
                        <ArrowLeft size={16} />
                        <span>{t('radio.exit')}</span>
                    </button>
                    <div className="p-radio-explorer__brand">
                        <div className="p-radio-explorer__brand-row">
                            <Radio size={18} />
                            <strong>{t('radio.title')}</strong>
                        </div>
                        <span className="p-radio-explorer__station-badge">
                            {t('radio.station_count', { count: nodes.length })}
                        </span>
                    </div>
                </div>

                <div className="p-radio-explorer__top-right">
                    <div className="p-radio-explorer__tools">
                        <button
                            className="p-radio-explorer__icon-btn"
                            type="button"
                            title={t('radio.search_station')}
                            aria-label={t('radio.search_station')}
                            aria-expanded={searchOpen}
                            onClick={() => setSearchOpen((current) => !current)}
                        >
                            <Search size={16} />
                        </button>
                        <div
                            className="p-radio-explorer__view-switch"
                            role="group"
                            aria-label={t('radio.view_mode')}
                        >
                            <button
                                type="button"
                                className={layout === 'globe' ? 'is-active' : undefined}
                                onClick={() => setLayout('globe')}
                            >
                                <Globe2 size={14} />
                                {t('radio.globe')}
                            </button>
                            <button
                                type="button"
                                className={layout === 'genres' ? 'is-active' : undefined}
                                onClick={() => setLayout('genres')}
                            >
                                <Sparkles size={14} />
                                {t('radio.genre_nebula')}
                            </button>
                        </div>
                        <button
                            className="p-radio-explorer__saved-btn"
                            type="button"
                            aria-expanded={favoritesOpen}
                            onClick={() => setFavoritesOpen((current) => !current)}
                        >
                            <Bookmark size={15} />
                            {t('radio.favorites')} {favorites.length}
                        </button>
                        <button
                            className="p-radio-explorer__icon-btn"
                            type="button"
                            title={
                                isFullscreen ? t('radio.exit_fullscreen') : t('radio.fullscreen')
                            }
                            aria-label={
                                isFullscreen ? t('radio.exit_fullscreen') : t('radio.fullscreen')
                            }
                            onClick={toggleFullscreen}
                        >
                            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                    </div>

                    <div className="p-radio-explorer__win-controls">
                        <button
                            className="p-radio-explorer__win-btn"
                            type="button"
                            title={t('app.minimize')}
                            aria-label={t('app.minimize')}
                            onClick={handleMinimize}
                        >
                            <Minus size={14} strokeWidth={1.5} />
                        </button>
                        <button
                            className="p-radio-explorer__win-btn"
                            type="button"
                            title={t('app.maximize')}
                            aria-label={t('app.maximize')}
                            onClick={handleMaximize}
                        >
                            <Square size={10} strokeWidth={1.5} />
                        </button>
                        <button
                            className="p-radio-explorer__win-btn p-radio-explorer__win-btn--close"
                            type="button"
                            title={t('common.close')}
                            aria-label={t('common.close')}
                            onClick={handleClose}
                        >
                            <X size={14} strokeWidth={1.5} />
                        </button>
                    </div>
                </div>
            </header>

            {searchOpen && (
                <section
                    className="p-radio-explorer__search-panel"
                    aria-label={t('radio.search_station')}
                >
                    <Search size={16} />
                    <input
                        autoFocus
                        value={searchQuery}
                        placeholder={t('radio.search_placeholder')}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                            if (event.key === 'Escape') setSearchOpen(false);
                            if (event.key === 'Enter' && searchResults[0]) {
                                chooseExternalStation(searchResults[0]);
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => setSearchOpen(false)}
                        aria-label={t('common.close')}
                    >
                        <X size={15} />
                    </button>
                    {searchQuery.trim() && (
                        <div className="p-radio-explorer__search-results">
                            {searchStatus === RequestStatus.Pending && (
                                <span>{t('common.loading')}…</span>
                            )}
                            {searchStatus === RequestStatus.Error && (
                                <span>{t('status.load_error')}</span>
                            )}
                            {searchResults.map((station) => (
                                <button
                                    type="button"
                                    key={stationKey(station)}
                                    onClick={() => chooseExternalStation(station)}
                                >
                                    <strong>{station.title}</strong>
                                    <span>
                                        {[
                                            formatCountryName(
                                                station.radioBrowser.countryCode,
                                                station.radioBrowser.country,
                                            ),
                                            formatLanguageName(station.radioBrowser.language),
                                            station.album,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {favoritesOpen && (
                <aside className="p-radio-explorer__favorites" aria-label={t('radio.favorites')}>
                    <header>
                        <div>
                            <Bookmark size={16} />
                            <strong>{t('radio.favorites')}</strong>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFavoritesOpen(false)}
                            aria-label={t('common.close')}
                        >
                            <X size={15} />
                        </button>
                    </header>
                    {favorites.length === 0 ? (
                        <p>{t('radio.favorites_empty')}</p>
                    ) : (
                        <div className="p-radio-explorer__favorite-list">
                            {favorites.map((station) => (
                                <div key={stationKey(station)}>
                                    <button
                                        type="button"
                                        onClick={() => chooseExternalStation(station)}
                                    >
                                        <strong>{station.title}</strong>
                                        <span>{station.artist}</span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={t('radio.remove_favorite')}
                                        onClick={() => musicSheet.removeRadioFavorite(station)}
                                    >
                                        <X size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </aside>
            )}

            <div className="p-radio-explorer__crosshair" aria-hidden="true">
                <span />
                <span />
            </div>
            <div className={`p-radio-explorer__tuning is-${tuningState}`} aria-live="polite">
                {tuningLabel}
            </div>

            {hoveredStation && hoveredKey !== selectedKey && (
                <div className="p-radio-explorer__tooltip">
                    <strong>{hoveredStation.title}</strong>
                    <span>{hoveredStation.artist}</span>
                </div>
            )}

            {selectedStation && (
                <section className="p-radio-explorer__station-hud" aria-live="polite">
                    <div className="p-radio-explorer__station-state">
                        {playingKey === selectedKey ? (
                            <span className="p-radio-explorer__live-badge">
                                <span className="p-radio-explorer__live-pulse" />
                                {t('radio.now_playing')}
                            </span>
                        ) : (
                            <span className="p-radio-explorer__select-badge">
                                {t('radio.selected_station')}
                            </span>
                        )}
                        {nodeByKey.get(selectedKey ?? '')?.geoSource !== 'exact' && (
                            <span className="p-radio-explorer__geo-badge">
                                {t('radio.estimated_location')}
                            </span>
                        )}
                    </div>
                    <h1 title={selectedStation.title}>{selectedStation.title}</h1>
                    <p className="p-radio-explorer__station-sub">
                        {[
                            formatCountryName(
                                selectedStation.radioBrowser.countryCode,
                                selectedStation.radioBrowser.country,
                            ),
                            formatLanguageName(selectedStation.radioBrowser.language),
                        ]
                            .filter(Boolean)
                            .join(' · ') || t('radio.title')}
                    </p>
                    <div className="p-radio-explorer__metadata">
                        <span>{nodeByKey.get(selectedKey ?? '')?.genreFamily}</span>
                        {selectedStation.radioBrowser.codec && (
                            <span>{selectedStation.radioBrowser.codec}</span>
                        )}
                        {selectedStation.radioBrowser.bitrate > 0 && (
                            <span>{selectedStation.radioBrowser.bitrate} kbps</span>
                        )}
                    </div>
                    <div className="p-radio-explorer__controls">
                        <button
                            type="button"
                            onClick={() => moveSelection(-1, true)}
                            aria-label={t('playback.previous')}
                            title={t('playback.previous')}
                        >
                            <SkipBack size={16} />
                        </button>
                        <button
                            type="button"
                            className="p-radio-explorer__play-btn"
                            onClick={handlePlayClick}
                            aria-label={
                                isPlaying && playingKey === selectedKey
                                    ? t('playback.pause')
                                    : t('playback.play')
                            }
                            title={
                                isPlaying && playingKey === selectedKey
                                    ? t('playback.pause')
                                    : t('playback.play')
                            }
                        >
                            {isPlaying && playingKey === selectedKey ? (
                                <Pause size={20} fill="currentColor" />
                            ) : (
                                <Play size={20} fill="currentColor" />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => moveSelection(1, true)}
                            aria-label={t('playback.next')}
                            title={t('playback.next')}
                        >
                            <SkipForward size={16} />
                        </button>
                        <button
                            type="button"
                            className={selectedFavorite ? 'is-active' : undefined}
                            onClick={toggleFavorite}
                            aria-pressed={selectedFavorite}
                            aria-label={
                                selectedFavorite
                                    ? t('radio.remove_favorite')
                                    : t('radio.add_favorite')
                            }
                            title={
                                selectedFavorite
                                    ? t('radio.remove_favorite')
                                    : t('radio.add_favorite')
                            }
                        >
                            <Bookmark size={16} fill={selectedFavorite ? 'currentColor' : 'none'} />
                        </button>
                        <button
                            type="button"
                            className={locked ? 'is-active' : undefined}
                            onClick={() => setLocked((current) => !current)}
                            aria-pressed={locked}
                            aria-label={
                                locked ? t('radio.unlock_station') : t('radio.lock_station')
                            }
                            title={locked ? t('radio.unlock_station') : t('radio.lock_station')}
                        >
                            {locked ? <Lock size={16} /> : <Unlock size={16} />}
                        </button>
                        <div className="p-radio-explorer__volume-ctrl">
                            <button
                                type="button"
                                onClick={toggleMute}
                                aria-label={
                                    volume === 0 ? t('playback.unmute') : t('playback.mute')
                                }
                                title={volume === 0 ? t('playback.unmute') : t('playback.mute')}
                            >
                                <VolumeIcon size={16} />
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={volume}
                                onChange={(e) => radioAudioPlayer.setVolume(Number(e.target.value))}
                                className="p-radio-explorer__volume-slider"
                                aria-label={t('playback.volume')}
                                title={`${Math.round(volume * 100)}%`}
                            />
                        </div>
                    </div>
                </section>
            )}

            {status === RequestStatus.Pending && stations.length === 0 && (
                <div className="p-radio-explorer__status">{t('radio.loading_world')}</div>
            )}
            {status === RequestStatus.Error && (
                <div className="p-radio-explorer__status is-error">
                    <AlertTriangle size={26} />
                    <span>{t('radio.load_error')}</span>
                    <button type="button" onClick={retry}>
                        {t('common.retry')}
                    </button>
                </div>
            )}
            {tuningOverlay && (
                <div className="p-radio-explorer__tuning-modal" role="status" aria-live="polite">
                    <div className="p-radio-explorer__tuning-badge">
                        <Radio size={14} className="p-radio-explorer__tuning-icon" />
                        <span>量子调频 · {tuningOverlay.genre}</span>
                    </div>
                    <div className="p-radio-explorer__tuning-waves" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                    </div>
                    <div className="p-radio-explorer__tuning-title">
                        {tuningOverlay.stationName}
                    </div>
                    <div className="p-radio-explorer__tuning-sub">
                        FM {tuningOverlay.freq} MHz · 正在锁定宇宙无线电信号...
                    </div>
                </div>
            )}

            {webglLost && (
                <div className="p-radio-explorer__status is-error">
                    <AlertTriangle size={26} />
                    <span>{t('radio.webgl_lost')}</span>
                </div>
            )}

            <footer className="p-radio-explorer__bottom">
                {filtersOpen && (
                    <div className="p-radio-explorer__filter-panel">
                        <div className="p-radio-explorer__filter-header">
                            <span className="p-radio-explorer__filter-title">
                                {t('radio.filter')}
                            </span>
                            {hasActiveFilters && (
                                <button
                                    type="button"
                                    className="p-radio-explorer__filter-reset"
                                    onClick={handleResetFilters}
                                >
                                    <RotateCcw size={12} />
                                    <span>{t('radio.reset_filters')}</span>
                                </button>
                            )}
                        </div>
                        <div className="p-radio-explorer__filter-group">
                            <span className="p-radio-explorer__filter-label">
                                {t('radio.bitrate')}
                            </span>
                            <div className="p-radio-explorer__filter-options">
                                {BITRATE_FILTERS.map((option) => (
                                    <button
                                        type="button"
                                        key={option.key}
                                        className={
                                            bitrateKey === option.key ? 'is-active' : undefined
                                        }
                                        onClick={() => setBitrateFilter(option.key)}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="p-radio-explorer__filter-row">
                            <label className="p-radio-explorer__filter-field">
                                <span>{t('radio.country')}</span>
                                <select
                                    value={filters.countryCode ?? ''}
                                    disabled={facetsStatus === RequestStatus.Pending}
                                    onChange={(event) =>
                                        setFilters((current) => ({
                                            ...current,
                                            countryCode: event.target.value || undefined,
                                        }))
                                    }
                                >
                                    <option value="">{t('radio.all_countries')}</option>
                                    {sortedCountries.map((country) => (
                                        <option key={country.value} value={country.value}>
                                            {formatCountryName(country.value, country.label)} (
                                            {country.count})
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="p-radio-explorer__filter-field">
                                <span>{t('radio.language')}</span>
                                <select
                                    value={filters.language ?? ''}
                                    disabled={facetsStatus === RequestStatus.Pending}
                                    onChange={(event) =>
                                        setFilters((current) => ({
                                            ...current,
                                            language: event.target.value || undefined,
                                        }))
                                    }
                                >
                                    <option value="">{t('radio.all_languages')}</option>
                                    {sortedLanguages.map((language) => (
                                        <option key={language.value} value={language.value}>
                                            {formatLanguageName(language.label || language.value)} (
                                            {language.count})
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        {facetsStatus === RequestStatus.Error && (
                            <button
                                type="button"
                                className="p-radio-explorer__filter-retry"
                                onClick={retryFacets}
                            >
                                {t('radio.retry_filters')}
                            </button>
                        )}
                    </div>
                )}
                <div className="p-radio-explorer__chips-bar">
                    {(canScrollLeft || canScrollRight) && (
                        <button
                            type="button"
                            className="p-radio-explorer__chips-arrow p-radio-explorer__chips-arrow--left"
                            style={{
                                visibility: canScrollLeft ? 'visible' : 'hidden',
                                opacity: canScrollLeft ? 1 : 0,
                            }}
                            aria-label="向左滚动"
                            onClick={() => handleScrollChips('left')}
                        >
                            <ChevronLeft size={16} />
                        </button>
                    )}
                    <div
                        ref={chipsRef}
                        className="p-radio-explorer__chips"
                        onScroll={checkScrollBounds}
                    >
                        <button
                            type="button"
                            className={filtersOpen ? 'is-active' : undefined}
                            onClick={() => setFiltersOpen((current) => !current)}
                        >
                            <SlidersHorizontal size={14} />
                            {t('radio.filter')}
                        </button>
                        {GENRE_FILTERS.map((genre) => (
                            <button
                                type="button"
                                key={genre.label}
                                aria-pressed={(filters.tag ?? '') === genre.tag}
                                className={
                                    (filters.tag ?? '') === genre.tag ? 'is-active' : undefined
                                }
                                onClick={() => handleGenreChipClick(genre)}
                            >
                                <span>{genre.label}</span>
                                <small>
                                    {genre.tag
                                        ? (tagCounts.get(genre.tag.toLowerCase()) ?? 0)
                                        : nodes.length}
                                </small>
                            </button>
                        ))}
                    </div>
                    {(canScrollLeft || canScrollRight) && (
                        <button
                            type="button"
                            className="p-radio-explorer__chips-arrow p-radio-explorer__chips-arrow--right"
                            style={{
                                visibility: canScrollRight ? 'visible' : 'hidden',
                                opacity: canScrollRight ? 1 : 0,
                            }}
                            aria-label="向右滚动"
                            onClick={() => handleScrollChips('right')}
                        >
                            <ChevronRight size={16} />
                        </button>
                    )}
                </div>
            </footer>

            <div className="p-radio-explorer__attribution">
                {t('radio.attribution_prefix')} <A href={RADIO_BROWSER_WEBSITE}>Radio Browser</A>
            </div>
        </div>
    );
}
