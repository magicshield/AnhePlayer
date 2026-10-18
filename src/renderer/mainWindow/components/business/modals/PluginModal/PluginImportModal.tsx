import { useCallback, useState } from 'react';
import { Link2, ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Modal from '@renderer/mainWindow/components/ui/Modal';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { Input } from '@renderer/mainWindow/components/ui/Input';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import { showModal } from '@renderer/mainWindow/components/ui/Modal/modalManager';
import { LOCAL_PLUGIN_NAME } from '@common/constant';
import pluginManager from '@infra/pluginManager/renderer';
import './index.scss';

type ImportType = 'importMusicItem' | 'importMusicSheet';

interface PluginImportModalProps {
    close: () => void;
    /** 目标插件；不传时先展示平台选择列表（侧边栏「导入歌单」入口） */
    plugin?: IPlugin.IPluginDelegate;
    type: ImportType;
}

/**
 * PluginImportModal — 导入单曲/歌单弹窗
 *
 * 单步流程：输入 URL → 加载 → 成功后链式打开 AddMusicToSheetModal
 * 未指定 plugin 时：先选择平台（支持 importMusicSheet 的插件，不含本地）再输入
 */
export default function PluginImportModal({ close, plugin, type }: PluginImportModalProps) {
    const { t } = useTranslation();
    const [selectedPlugin, setSelectedPlugin] = useState<IPlugin.IPluginDelegate | null>(
        plugin ?? null,
    );
    const [inputValue, setInputValue] = useState('');
    const [loading, setLoading] = useState(false);

    const handleConfirm = useCallback(async () => {
        if (!selectedPlugin) return;
        const trimmed = inputValue.trim();
        if (!trimmed) return;

        setLoading(true);
        try {
            const result = await pluginManager.callPluginMethod({
                hash: selectedPlugin.hash,
                method: type,
                args: [trimmed],
            });

            if (result) {
                const items = Array.isArray(result) ? result : [result];
                if (items.length === 0) {
                    showToast(t('plugin.import_empty_result'), { type: 'warn' });
                    return;
                }
                close();
                showModal('AddMusicToSheetModal', { musicItems: items });
            } else {
                showToast(t('plugin.import_invalid_link'), { type: 'warn' });
            }
        } catch (e: any) {
            showToast(t('plugin.import_error', { reason: e?.message ?? '' }), {
                type: 'warn',
            });
        } finally {
            setLoading(false);
        }
    }, [inputValue, selectedPlugin, type, close, t]);

    // ── 未指定插件：先选择平台 ──
    if (!selectedPlugin) {
        const candidates = pluginManager
            .getSupportedPlugin('importMusicSheet')
            .filter((p) => p.platform !== LOCAL_PLUGIN_NAME);
        return (
            <Modal open onClose={close} title={t('plugin.method_import_music_sheet')} size="md">
                <div className="plugin-modal__sheet-list">
                    {candidates.map((p) => (
                        <button
                            key={p.hash}
                            type="button"
                            className="plugin-modal__sheet-item"
                            onClick={() => setSelectedPlugin(p)}
                        >
                            <ListPlus size={16} />
                            <span>{p.platform}</span>
                        </button>
                    ))}
                </div>
            </Modal>
        );
    }

    // ── hints ──
    const isTrack = type === 'importMusicItem';
    const title = isTrack
        ? `${t('plugin.method_import_music_item')} · ${selectedPlugin.platform}`
        : `${t('plugin.method_import_music_sheet')} · ${selectedPlugin.platform}`;
    const placeholder = isTrack
        ? t('plugin.placeholder_import_music_item', { plugin: selectedPlugin.platform })
        : t('plugin.placeholder_import_music_sheet', { plugin: selectedPlugin.platform });
    const hints = selectedPlugin.hints?.[type];

    return (
        <Modal
            open
            onClose={close}
            title={title}
            size="md"
            footer={
                <>
                    <Button variant="secondary" onClick={close} disabled={loading}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleConfirm}
                        loading={loading}
                        disabled={!inputValue.trim()}
                    >
                        {t('common.confirm')}
                    </Button>
                </>
            }
        >
            <div className="plugin-modal__import">
                <Input
                    prefix={isTrack ? <Link2 size={16} /> : <ListPlus size={16} />}
                    placeholder={placeholder}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    disabled={loading}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirm();
                    }}
                />
                {hints && hints.length > 0 && (
                    <div className="plugin-modal__hints">
                        {hints.map((hint, i) => (
                            <p key={i} className="plugin-modal__hint-item">
                                {hint}
                            </p>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}
