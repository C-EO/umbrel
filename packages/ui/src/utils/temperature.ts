import {t} from '@/utils/i18n'

export function celciusToFahrenheit(temperatureInCelcius?: number) {
	if (temperatureInCelcius === undefined) return undefined
	return Math.round((temperatureInCelcius * 9) / 5 + 32)
}

/** Format temperature with unit label (e.g., "45°C" or "113°F") */
export function formatTemperature(tempCelcius: number | undefined, unit: 'c' | 'f'): string {
	if (tempCelcius === undefined) return '--'
	const temp = unit === 'f' ? celciusToFahrenheit(tempCelcius) : tempCelcius
	const label = unit === 'c' ? '°C' : '°F'
	return `${temp}${label}`
}

export function temperatureWarningToMessage(warning?: string) {
	if (warning === undefined) return ''

	if (warning === 'normal') {
		return t('temperature.normal')
	}
	if (warning === 'warm') {
		return t('temperature.warm')
	}
	if (warning === 'hot') {
		return t('temperature.dangerously-hot')
	}
	return t('temperature.normal')
}
