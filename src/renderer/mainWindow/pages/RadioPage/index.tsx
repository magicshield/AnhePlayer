import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
    AlertTriangle,
    Bookmark,
    Globe2,
    Lock,
    Pause,
    Play,
    Radio,
    Search,
    SkipBack,
    SkipForward,
    SlidersHorizontal,
    Sparkles,
    Unlock,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlayerState, RequestStatus } from '@common/constant';
import { compositeKey } from '@common/mediaKey';
import {
    RADIO_BROWSER_PLATFORM,
    RADIO_BROWSER_WEBSITE,
    type IRadioBrowserMusicItem,
    isRadioBrowserMedia,
} from '@common/radioBrowser';
import type { IRadioStationFilters } from '@infra/radioBrowser/renderer';
import musicSheet, { useRadioFavorites, useRadioIsFavorite } from '@infra/musicSheet/renderer';
import { useCurrentThemePack } from '@infra/themepack/renderer';
import trackPlayer from '@renderer/mainWindow/core/trackPlayer';
import { useCurrentMusic, usePlayerState } from '@renderer/mainWindow/core/trackPlayer/hooks';
import { A } from '../../components/ui/A';
import RadioScene, { type IRadioSceneHandle } from './components/RadioScene';
import {
    buildRadioSceneNodes,
    type RadioGenreFamily,
    type RadioSceneLayout,
} from './data/sceneLayout';
import { useRadioExplorer, useRadioSearch } from './useRadioExplorer';
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
    const currentMusic = useCurrentMusic();
    const playerState = usePlayerState();
    const currentTheme = useCurrentThemePack();
    const favorites = useRadioFavorites();
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
    const playingKey = isRadioBrowserMedia(currentMusic)
        ? compositeKey(currentMusic.platform, String(currentMusic.id))
        : null;
    const selectedStation = selectedKey ? (nodeByKey.get(selectedKey)?.station ?? null) : null;
    const hoveredStation = hoveredKey ? (nodeByKey.get(hoveredKey)?.station ?? null) : null;
    const selectedFavorite = useRadioIsFavorite(
        selectedStation ?? { platform: RADIO_BROWSER_PLATFORM, id: '' },
    );
    const isPlaying = playerState === PlayerState.Playing;

    useEffect(() => {
        if (selectedKey && nodeByKey.has(selectedKey)) return;
        const first = nodes[0];
        if (first) setSelectedKey(first.key);
    }, [nodeByKey, nodes, selectedKey]);

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
            if (automatic && playingKey === key) {
                setTuningState(locked ? 'locked' : 'idle');
                return;
            }
            const generation = ++tuneGenerationRef.current;
            setTuningState('buffering');
            try {
                await trackPlayer.tuneRadio(station);
                if (generation !== tuneGenerationRef.current) return;
                lastTuneAtRef.current = Date.now();
                setTuningState(locked ? 'locked' : 'idle');
            } catch {
                if (generation === tuneGenerationRef.current) setTuningState('error');
            }
        },
        [locked, playingKey],
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
            if (isPlaying) trackPlayer.pause();
            else trackPlayer.resume();
        } else {
            tuneStation(selectedStation);
        }
    }, [isPlaying, playingKey, selectedStation, tuneStation]);

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

    const setBitrateFilter = useCallback((key: string) => {
        const target = BITRATE_FILTERS.find((item) => item.key === key) ?? BITRATE_FILTERS[0];
        setBitrateKey(target.key);
        setFilters((current) => ({
            ...current,
            bitrateMin: target.min,
            bitrateMax: target.max,
        }));
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
                trackPlayer.togglePlayPause();
            } else if (event.key === 'ArrowLeft') {
                moveSelection(-1, true);
            } else if (event.key === 'ArrowRight') {
                moveSelection(1, true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [moveSelection, toggleFavorite]);

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
                <div className="p-radio-explorer__brand">
                    <div className="p-radio-explorer__brand-row">
                        <Radio size={18} />
                        <strong>{t('radio.title')}</strong>
                    </div>
                    <span>{t('radio.station_count', { count: nodes.length })}</span>
                </div>

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
                                            station.radioBrowser.country,
                                            station.radioBrowser.language,
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
                        {playingKey === selectedKey
                            ? t('radio.now_playing')
                            : t('radio.selected_station')}
                        {nodeByKey.get(selectedKey ?? '')?.geoSource !== 'exact' && (
                            <span>{t('radio.estimated_location')}</span>
                        )}
                    </div>
                    <h1>{selectedStation.title}</h1>
                    <p>
                        {[
                            selectedStation.radioBrowser.country,
                            selectedStation.radioBrowser.language,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
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
                        >
                            {locked ? <Lock size={16} /> : <Unlock size={16} />}
                        </button>
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
            {webglLost && (
                <div className="p-radio-explorer__status is-error">
                    <AlertTriangle size={26} />
                    <span>{t('radio.webgl_lost')}</span>
                </div>
            )}

            <footer className="p-radio-explorer__bottom">
                {filtersOpen && (
                    <div className="p-radio-explorer__filter-panel">
                        <div>
                            <strong>{t('radio.bitrate')}</strong>
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
                        <label>
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
                                {facets.countries.map((country) => (
                                    <option key={country.value} value={country.value}>
                                        {country.label} ({country.count})
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
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
                                {facets.languages.map((language) => (
                                    <option key={language.value} value={language.value}>
                                        {language.label} ({language.count})
                                    </option>
                                ))}
                            </select>
                        </label>
                        {facetsStatus === RequestStatus.Error && (
                            <button type="button" onClick={retryFacets}>
                                {t('radio.retry_filters')}
                            </button>
                        )}
                    </div>
                )}
                <div className="p-radio-explorer__chips">
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
                            className={(filters.tag ?? '') === genre.tag ? 'is-active' : undefined}
                            onClick={() =>
                                setFilters((current) => ({
                                    ...current,
                                    tag: genre.tag || undefined,
                                }))
                            }
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
            </footer>

            <div className="p-radio-explorer__attribution">
                {t('radio.attribution_prefix')} <A href={RADIO_BROWSER_WEBSITE}>Radio Browser</A>
            </div>
        </div>
    );
}
