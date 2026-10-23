import {
    useState,
    useEffect,
    useMemo,
    useRef,
    useDeferredValue,
    useCallback,
    type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Radio, Sparkles, Waves, User, RotateCw, LogOut, LogIn, FolderPlus } from 'lucide-react';
import { RequestStatus } from '@common/constant';
import trackPlayer from '@renderer/mainWindow/core/trackPlayer';
import neteaseAccount, { useNeteaseAccountStatus } from '@infra/neteaseAccount/renderer';
import { TabBar, type TabItem } from '../../components/ui/TabBar';
import { SongToolbar } from '../../components/ui/SongToolbar';
import { SongTable, type RowInteractionDetail } from '../../components/business/SongTable';
import { FavoriteButton } from '../../components/business/FavoriteButton';
import { DownloadButton } from '../../components/business/DownloadButton';
import { Button } from '../../components/ui/Button';
import { StatusPlaceholder } from '../../components/ui/StatusPlaceholder';
import { showContextMenu } from '../../components/ui/ContextMenu/contextMenuManager';
import { showModal } from '../../components/ui/Modal/modalManager';
import { showToast } from '../../components/ui/Toast';
import './index.scss';

type TabKey = 'radar' | 'daily' | 'fm';

interface RadarMeta {
    title?: string;
    description?: string;
    isFallback?: boolean;
}

export default function NeteaseRecommendPage() {
    const { t } = useTranslation();
    const accountStatus = useNeteaseAccountStatus();

    const [activeTab, setActiveTab] = useState<TabKey>('radar');
    const [radarSongs, setRadarSongs] = useState<IMusic.IMusicItem[]>([]);
    const [radarMeta, setRadarMeta] = useState<RadarMeta>({});
    const [dailySongs, setDailySongs] = useState<IMusic.IMusicItem[]>([]);
    const [fmSongs, setFmSongs] = useState<IMusic.IMusicItem[]>([]);
    const [requestStatus, setRequestStatus] = useState<RequestStatus>(RequestStatus.Idle);
    const [searchValue, setSearchValue] = useState('');
    const deferredSearch = useDeferredValue(searchValue);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    // 请求序号：快速切 Tab 时丢弃过期请求的结果，避免旧请求覆盖新状态
    const requestSeqRef = useRef(0);

    const tabItems: TabItem[] = useMemo(
        () => [
            {
                key: 'radar',
                label: t('netease.radar'),
                icon: <Radio size={16} />,
            },
            {
                key: 'daily',
                label: t('netease.daily'),
                icon: <Sparkles size={16} />,
            },
            {
                key: 'fm',
                label: t('netease.fm'),
                icon: <Waves size={16} />,
            },
        ],
        [t],
    );

    const currentSongs =
        activeTab === 'radar' ? radarSongs : activeTab === 'daily' ? dailySongs : fmSongs;

    const filteredSongs = useMemo(() => {
        const keyword = deferredSearch.trim().toLowerCase();
        if (!keyword) return currentSongs;
        return currentSongs.filter(
            (item) =>
                item.title.toLowerCase().includes(keyword) ||
                (item.artist ?? '').toLowerCase().includes(keyword) ||
                (item.album ?? '').toLowerCase().includes(keyword),
        );
    }, [currentSongs, deferredSearch]);

    const fetchData = useCallback(
        async (tab: TabKey) => {
            if (!accountStatus.connected) return;

            const seq = ++requestSeqRef.current;
            setRequestStatus(RequestStatus.Pending);
            try {
                if (tab === 'radar') {
                    const radarResult = await neteaseAccount.getPrivateRadarSongs();
                    if (seq !== requestSeqRef.current) return;
                    setRadarSongs(radarResult.songs);
                    setRadarMeta({
                        title: radarResult.title,
                        description: radarResult.description,
                        isFallback: radarResult.isFallback,
                    });
                } else if (tab === 'daily') {
                    const songs = await neteaseAccount.getDailyRecommendSongs();
                    if (seq !== requestSeqRef.current) return;
                    setDailySongs(songs);
                } else {
                    const songs = await neteaseAccount.getPrivateFmSongs();
                    if (seq !== requestSeqRef.current) return;
                    setFmSongs(songs);
                }
                setRequestStatus(RequestStatus.Done);
            } catch {
                if (seq !== requestSeqRef.current) return;
                setRequestStatus(RequestStatus.Error);
            }
        },
        [accountStatus.connected],
    );

    useEffect(() => {
        if (accountStatus.connected) {
            void fetchData(activeTab);
        } else {
            // 作废进行中的请求，避免退出登录后旧结果回填
            requestSeqRef.current++;
            setRadarSongs([]);
            setDailySongs([]);
            setFmSongs([]);
            setRequestStatus(RequestStatus.Idle);
        }
    }, [accountStatus.connected, activeTab, fetchData]);

    // 登录成功后由账号状态广播触发上面的 effect 拉取数据，这里不再手动请求
    const handleLogin = useCallback(async () => {
        if (isLoggingIn) return;
        setIsLoggingIn(true);
        try {
            await neteaseAccount.openLogin();
        } catch {
            showToast(t('netease.login_failed'), { type: 'warn' });
        } finally {
            setIsLoggingIn(false);
        }
    }, [isLoggingIn, t]);

    const handleLogout = useCallback(async () => {
        try {
            await neteaseAccount.logout();
        } catch {
            showToast(t('netease.logout_failed'), { type: 'warn' });
        }
    }, [t]);

    const radarTitle = radarMeta.isFallback
        ? t('netease.radar_fallback_title')
        : radarMeta.title || t('netease.radar');
    const radarDescription = radarMeta.isFallback
        ? t('netease.radar_fallback_desc')
        : radarMeta.description || t('netease.radar_desc');

    const handlePlayAll = useCallback(() => {
        if (filteredSongs.length === 0) return;
        trackPlayer.playMusicWithReplaceQueue(filteredSongs);
        // 私人漫游：注册续取回调，接近队尾时自动取下一批
        if (activeTab === 'fm') {
            trackPlayer.setRadioSource(() => neteaseAccount.getPrivateFmSongs());
        }
    }, [filteredSongs, activeTab]);

    const handleAddToSheet = useCallback(() => {
        if (filteredSongs.length === 0) return;
        showModal('AddMusicToSheetModal', { musicItems: filteredSongs });
    }, [filteredSongs]);

    const handleRowContextMenu = useCallback(
        ({ selectedItems }: RowInteractionDetail, e: MouseEvent) => {
            showContextMenu(
                'MusicItemMenu',
                { x: e.clientX, y: e.clientY },
                {
                    musicItems: selectedItems as IMusic.IMusicItem[],
                },
            );
        },
        [],
    );

    return (
        <div className="p-netease-recommend">
            {/* Header: User / Login Status */}
            <div className="p-netease-recommend__header">
                {accountStatus.connected && accountStatus.profile ? (
                    <>
                        <div className="p-netease-recommend__user">
                            <div className="p-netease-recommend__avatar">
                                {accountStatus.profile.avatarUrl ? (
                                    <img
                                        src={accountStatus.profile.avatarUrl}
                                        alt={
                                            accountStatus.profile.nickname ||
                                            t('netease.default_nickname')
                                        }
                                    />
                                ) : (
                                    <User size={28} />
                                )}
                            </div>
                            <div className="p-netease-recommend__user-info">
                                <div className="p-netease-recommend__user-name-row">
                                    <span className="p-netease-recommend__nickname">
                                        {accountStatus.profile.nickname ||
                                            t('netease.default_nickname')}
                                    </span>
                                    {accountStatus.profile.vipType &&
                                    accountStatus.profile.vipType > 0 ? (
                                        <span className="p-netease-recommend__vip-badge">VIP</span>
                                    ) : null}
                                    <span className="p-netease-recommend__status-tag">
                                        {t('netease.connected_status')}
                                    </span>
                                </div>
                                <div className="p-netease-recommend__user-sub">
                                    <span>{accountStatus.profile.accountHint}</span>
                                    {accountStatus.profile.signature ? (
                                        <span>· {accountStatus.profile.signature}</span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <div className="p-netease-recommend__actions">
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<RotateCw size={14} />}
                                onClick={() => void fetchData(activeTab)}
                            >
                                {t('common.retry')}
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<LogOut size={14} />}
                                onClick={() => void handleLogout()}
                            >
                                {t('netease.logout')}
                            </Button>
                        </div>
                    </>
                ) : (
                    <div className="p-netease-recommend__unlogged">
                        <div className="p-netease-recommend__unlogged-left">
                            <div className="p-netease-recommend__unlogged-icon">
                                <Radio size={26} />
                            </div>
                            <div className="p-netease-recommend__unlogged-text">
                                <h3>{t('netease.login_tip_title')}</h3>
                                <p>{t('netease.login_tip_desc')}</p>
                            </div>
                        </div>
                        <Button
                            variant="primary"
                            size="md"
                            icon={<LogIn size={16} />}
                            loading={isLoggingIn}
                            onClick={() => void handleLogin()}
                        >
                            {t('netease.login')}
                        </Button>
                    </div>
                )}
            </div>

            {/* Content when not logged in */}
            {!accountStatus.connected ? (
                <div className="p-netease-recommend__empty-card">
                    <Radio size={48} strokeWidth={1.5} color="var(--color-text-secondary)" />
                    <p>{t('netease.empty_guide')}</p>
                    <Button
                        variant="primary"
                        size="md"
                        icon={<LogIn size={16} />}
                        loading={isLoggingIn}
                        onClick={() => void handleLogin()}
                    >
                        {t('netease.login_btn')}
                    </Button>
                </div>
            ) : (
                <>
                    {/* Tabs */}
                    <div className="p-netease-recommend__tabs">
                        <TabBar
                            items={tabItems}
                            activeKey={activeTab}
                            onChange={(key) => setActiveTab(key as TabKey)}
                        />
                    </div>

                    {/* Meta Banner */}
                    <div className="p-netease-recommend__meta-banner">
                        <div>
                            <span className="p-netease-recommend__meta-title">
                                {activeTab === 'radar'
                                    ? radarTitle
                                    : activeTab === 'daily'
                                      ? t('netease.daily_recommend_title')
                                      : t('netease.fm_title')}
                            </span>
                            <span>
                                {activeTab === 'radar'
                                    ? radarDescription
                                    : activeTab === 'daily'
                                      ? t('netease.daily_recommend_desc')
                                      : t('netease.fm_desc')}
                            </span>
                        </div>
                        <span>{t('netease.total_count', { count: currentSongs.length })}</span>
                    </div>

                    {/* Toolbar */}
                    <div className="p-netease-recommend__toolbar">
                        <SongToolbar
                            searchPlaceholder={t('playlist.sheet_search_placeholder')}
                            searchValue={searchValue}
                            onSearchChange={setSearchValue}
                            onPlayAll={handlePlayAll}
                            disabled={currentSongs.length === 0}
                        >
                            <Button
                                variant="secondary"
                                size="md"
                                icon={<FolderPlus size={16} />}
                                onClick={handleAddToSheet}
                                disabled={currentSongs.length === 0}
                            >
                                {t('playlist.add_to_sheet_menu')}
                            </Button>
                            <Button
                                variant="secondary"
                                size="md"
                                icon={<RotateCw size={16} />}
                                onClick={() => void fetchData(activeTab)}
                            >
                                {t('common.retry')}
                            </Button>
                        </SongToolbar>
                    </div>

                    {/* Song Table */}
                    {requestStatus === RequestStatus.Pending && currentSongs.length === 0 ? (
                        <StatusPlaceholder status={RequestStatus.Pending} />
                    ) : requestStatus === RequestStatus.Error && currentSongs.length === 0 ? (
                        <StatusPlaceholder
                            status={RequestStatus.Error}
                            onRetry={() => void fetchData(activeTab)}
                        />
                    ) : (
                        <SongTable
                            data={filteredSongs}
                            requestStatus={RequestStatus.Done}
                            onRetry={() => void fetchData(activeTab)}
                            enableSelection
                            statusColumn={(item) => (
                                <>
                                    <FavoriteButton musicItem={item} size="sm" />
                                    <DownloadButton musicItem={item} size="sm" />
                                </>
                            )}
                            onRowContextMenu={handleRowContextMenu}
                        />
                    )}
                </>
            )}
        </div>
    );
}
