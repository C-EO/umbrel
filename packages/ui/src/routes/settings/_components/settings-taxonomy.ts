import {useTranslation} from 'react-i18next'

export const SETTINGS_CATEGORY_IDS = ['account', 'storage', 'system', 'troubleshoot'] as const
export const SETTINGS_FILTER_IDS = ['all', ...SETTINGS_CATEGORY_IDS] as const

export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number]
export type SettingsFilterId = (typeof SETTINGS_FILTER_IDS)[number]

export const suppliedSettingsIcons = {
	account: '/assets/settings/icons/account.svg',
	deviceInfo: '/assets/settings/icons/device-info.svg',
	language: '/assets/settings/icons/language.svg',
	migrationAssistant: '/assets/settings/icons/migration-assistant.svg',
	storageManager: '/assets/settings/icons/storage-manager.svg',
	wallpaper: '/assets/settings/icons/wallpaper.svg',
	wifi: '/assets/settings/icons/wifi.svg',
} as const

export function useSettingsFilterLabels(): Record<SettingsFilterId, string> {
	const {t} = useTranslation()

	return {
		all: t('settings.filter.all'),
		account: t('account'),
		storage: t('storage'),
		system: t('settings.filter.system'),
		troubleshoot: t('troubleshoot'),
	}
}
