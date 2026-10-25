import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCard } from '../components/SettingsCard';
import { SettingRow } from '../components/SettingRow';
import { Select } from '@renderer/mainWindow/components/ui/Select';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';
import appConfig from '@infra/appConfig/renderer';
import { getFacets, type IRadioBrowserFacets } from '@infra/radioBrowser/renderer';
import { formatCountryName, formatLanguageName } from '../../RadioPage/utils/geoLanguageMap';
import type { IAudioOutputDevice } from '@appTypes/infra/appConfig';

/**
 * 播放设置
 *
 * 配置项：defaultQuality、whenQualityMissing、clickMusicList、
 *         playError、audioOutputDevice、whenDeviceRemoved、caseSensitiveInSearch
 */
export function PlaybackSection() {
    const { t } = useTranslation();
    const [defaultQuality, setDefaultQuality] = useConfigValue('playMusic.defaultQuality');
    const [whenQualityMissing, setWhenQualityMissing] = useConfigValue(
        'playMusic.whenQualityMissing',
    );
    const [clickMusicList, setClickMusicList] = useConfigValue('playMusic.clickMusicList');
    const [playError, setPlayError] = useConfigValue('playMusic.playError');
    const [whenDeviceRemoved, setWhenDeviceRemoved] = useConfigValue('playMusic.whenDeviceRemoved');
    const [caseSensitive, setCaseSensitive] = useConfigValue('playMusic.caseSensitiveInSearch');

    // 电台偏好配置
    const [radioBitrate, setRadioBitrate] = useConfigValue('radio.bitrate');
    const [radioCountryCode, setRadioCountryCode] = useConfigValue('radio.countryCode');
    const [radioLanguage, setRadioLanguage] = useConfigValue('radio.language');

    const [facets, setFacets] = useState<IRadioBrowserFacets>({
        countries: [],
        languages: [],
        tags: [],
    });

    useEffect(() => {
        getFacets()
            .then((res) => {
                setFacets(res);
            })
            .catch(() => {});
    }, []);

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

    const radioBitrateOptions = useMemo(
        () => [
            { value: 'all', label: t('radio.all_bitrates') },
            { value: '128', label: '≥ 128 kbps' },
            { value: '192', label: '≥ 192 kbps' },
            { value: '320', label: '320 kbps' },
        ],
        [t],
    );

    const countryOptions = useMemo(() => {
        const options = [
            { value: '', label: t('radio.all_countries') },
            ...sortedCountries.map((c) => ({
                value: c.value,
                label: `${formatCountryName(c.value, c.label)} (${c.count})`,
            })),
        ];
        if (radioCountryCode && !options.some((o) => o.value === radioCountryCode)) {
            options.push({
                value: radioCountryCode,
                label: formatCountryName(radioCountryCode),
            });
        }
        return options;
    }, [radioCountryCode, sortedCountries, t]);

    const languageOptions = useMemo(() => {
        const options = [
            { value: '', label: t('radio.all_languages') },
            ...sortedLanguages.map((l) => ({
                value: l.value,
                label: `${formatLanguageName(l.label || l.value)} (${l.count})`,
            })),
        ];
        if (radioLanguage && !options.some((o) => o.value === radioLanguage)) {
            options.push({
                value: radioLanguage,
                label: formatLanguageName(radioLanguage),
            });
        }
        return options;
    }, [radioLanguage, sortedLanguages, t]);

    // 音频输出设备列表
    const [outputDevices, setOutputDevices] = useState<IAudioOutputDevice[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default');
    const [audioOutputDevice, setAudioOutputDevice] = useConfigValue('playMusic.audioOutputDevice');

    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
            const audioOutputs: IAudioOutputDevice[] = devices
                .filter((d) => d.kind === 'audiooutput')
                .map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label,
                    groupId: d.groupId,
                }));
            setOutputDevices(audioOutputs);
        });
    }, []);

    useEffect(() => {
        if (audioOutputDevice) {
            setSelectedDeviceId(audioOutputDevice.deviceId || 'default');
        }
    }, [audioOutputDevice]);

    const handleDeviceChange = useCallback(
        (deviceId: string) => {
            setSelectedDeviceId(deviceId);
            const device = outputDevices.find((d) => d.deviceId === deviceId);
            if (device) {
                setAudioOutputDevice(device);
            } else {
                // 选择 "系统默认" 时清除已保存的设备
                appConfig.setConfig({ 'playMusic.audioOutputDevice': null });
            }
        },
        [outputDevices, setAudioOutputDevice],
    );

    const deviceOptions = useMemo(
        () => [
            { value: 'default', label: t('settings.playback.system_default') },
            ...outputDevices
                .filter((d) => d.deviceId !== 'default')
                .map((d) => ({
                    value: d.deviceId,
                    label: d.label || d.deviceId,
                })),
        ],
        [outputDevices, t],
    );

    return (
        <>
            <SettingsCard
                title={t('settings.section_name.playback')}
                subtitle={t('settings.playback.subtitle')}
            >
                <SettingRow
                    label={t('settings.playback.default_quality_label')}
                    description={t('settings.playback.default_quality_desc')}
                    control={
                        <Select
                            value={defaultQuality ?? 'standard'}
                            onChange={setDefaultQuality}
                            options={[
                                { value: 'low', label: t('quality.low') },
                                { value: 'standard', label: t('quality.standard') },
                                { value: 'high', label: t('quality.high') },
                                { value: 'super', label: t('quality.super') },
                            ]}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.when_quality_missing_label')}
                    description={t('settings.playback.when_quality_missing_desc')}
                    control={
                        <Select
                            value={whenQualityMissing ?? 'lower'}
                            onChange={setWhenQualityMissing}
                            options={[
                                { value: 'lower', label: t('settings.playback.play_lower') },
                                { value: 'higher', label: t('settings.playback.play_higher') },
                                { value: 'skip', label: t('settings.playback.skip') },
                            ]}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.double_click_label')}
                    description={t('settings.playback.double_click_desc')}
                    control={
                        <Select
                            value={clickMusicList ?? 'replace'}
                            onChange={setClickMusicList}
                            options={[
                                { value: 'normal', label: t('settings.playback.add_to_queue') },
                                { value: 'replace', label: t('settings.playback.replace_queue') },
                            ]}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.play_error_label')}
                    description={t('settings.playback.play_error_desc')}
                    control={
                        <Select
                            value={playError ?? 'retry_with_source'}
                            onChange={setPlayError}
                            options={[
                                {
                                    value: 'retry_with_source',
                                    label: t('settings.playback.retry_with_source'),
                                },
                                { value: 'skip', label: t('settings.playback.skip_to_next') },
                                { value: 'pause', label: t('settings.playback.pause') },
                            ]}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.output_device_label')}
                    description={t('settings.playback.output_device_desc')}
                    control={
                        <Select
                            value={selectedDeviceId}
                            onChange={handleDeviceChange}
                            options={deviceOptions}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.device_removed_label')}
                    description={t('settings.playback.device_removed_desc')}
                    control={
                        <Select
                            value={whenDeviceRemoved ?? 'play'}
                            onChange={setWhenDeviceRemoved}
                            options={[
                                { value: 'play', label: t('settings.playback.continue_playing') },
                                { value: 'pause', label: t('settings.playback.pause') },
                            ]}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.case_sensitive_label')}
                    description={t('settings.playback.case_sensitive_desc')}
                    control={
                        <Select
                            value={caseSensitive ? 'true' : 'false'}
                            onChange={(val) => setCaseSensitive(val === 'true')}
                            options={[
                                { value: 'false', label: t('settings.playback.case_insensitive') },
                                { value: 'true', label: t('settings.playback.case_sensitive') },
                            ]}
                        />
                    }
                />
            </SettingsCard>

            <SettingsCard
                title={t('settings.playback.radio_title')}
                subtitle={t('settings.playback.radio_subtitle')}
            >
                <SettingRow
                    label={t('settings.playback.radio_bitrate_label')}
                    description={t('settings.playback.radio_bitrate_desc')}
                    control={
                        <Select
                            value={radioBitrate ?? 'all'}
                            onChange={(val) =>
                                setRadioBitrate(val as 'all' | '128' | '192' | '320')
                            }
                            options={radioBitrateOptions}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.radio_country_label')}
                    description={t('settings.playback.radio_country_desc')}
                    control={
                        <Select
                            value={radioCountryCode ?? ''}
                            onChange={setRadioCountryCode}
                            options={countryOptions}
                        />
                    }
                />
                <SettingRow
                    label={t('settings.playback.radio_language_label')}
                    description={t('settings.playback.radio_language_desc')}
                    control={
                        <Select
                            value={radioLanguage ?? ''}
                            onChange={setRadioLanguage}
                            options={languageOptions}
                        />
                    }
                />
            </SettingsCard>
        </>
    );
}
