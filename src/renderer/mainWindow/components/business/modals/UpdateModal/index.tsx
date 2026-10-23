import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '@renderer/mainWindow/components/ui/Modal';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { CheckboxGroup } from '@renderer/mainWindow/components/ui/CheckboxGroup';
import { syncKV } from '@renderer/common/kvStore';
import { OFFICIAL_SITE_URL } from '@common/constant';
import systemUtil from '@infra/systemUtil/renderer';
import type { IUpdateInfo } from '@appTypes/infra/systemUtil';
import { clearPendingUpdate } from '@renderer/mainWindow/common/updateNotice';
import './index.scss';

export interface UpdateModalProps {
    close: () => void;
    /** 更新详情（version / changeLog / download） */
    updateInfo: NonNullable<IUpdateInfo['update']>;
}

/**
 * UpdateModal — 软件更新提示弹窗（业务组件）
 *
 * 启动时检测到新版本后弹出，展示版本号、更新日志和下载链接。
 * 用户可勾选"不再提示此版本"，将版本号写入 localStorage，
 * 下次启动时跳过该版本（及更低版本）的提示。
 */
export default function UpdateModal({ close, updateInfo }: UpdateModalProps) {
    const { t } = useTranslation();
    const { version, changeLog } = updateInfo;

    const [skipChecked, setSkipChecked] = useState(
        () => syncKV.get('update.skipVersion') === version,
    );

    const handleSkipChange = useCallback(
        (value: string[]) => {
            const checked = value.includes('skip');
            setSkipChecked(checked);
            if (checked) {
                syncKV.set('update.skipVersion', version);
                clearPendingUpdate();
            } else {
                syncKV.remove('update.skipVersion');
            }
        },
        [version],
    );

    const handleDownload = useCallback(() => {
        clearPendingUpdate();
        systemUtil.openExternal(OFFICIAL_SITE_URL);
        close();
    }, [close]);

    return (
        <Modal
            open
            onClose={close}
            title={t('app.new_version_found', { version })}
            size="sm"
            footer={
                <div className="update-modal__footer">
                    <CheckboxGroup
                        value={skipChecked ? ['skip'] : []}
                        options={[{ value: 'skip', label: t('app.skip_version') }]}
                        onChange={handleSkipChange}
                    />
                    <div className="update-modal__actions">
                        <Button variant="primary" size="sm" onClick={handleDownload}>
                            {t('app.go_download')}
                        </Button>
                    </div>
                </div>
            }
        >
            {changeLog && changeLog.length > 0 && (
                <ul className="update-modal__changelog">
                    {changeLog.map((item, i) => (
                        <li key={i} className="update-modal__changelog-item">
                            {item}
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}
