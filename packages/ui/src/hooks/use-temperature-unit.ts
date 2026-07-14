import {trpcReact} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'

// Regions that commonly use Fahrenheit (US and its territories, plus a few others)
const regionsWithFahrenheitTemperature = ['US', 'AS', 'BS', 'BZ', 'FM', 'GU', 'KY', 'MH', 'MP', 'PR', 'PW', 'VI']

export const temperatureDescriptions = [
	{id: 'c', label: '°C'},
	{id: 'f', label: '°F'},
] as const

export type TemperatureUnit = (typeof temperatureDescriptions)[number]['id']

// Returns the temperature unit commonly used in a locale's region, e.g. 'en-US' → 'f', 'en-GB' → 'c'.
// `maximize()` infers the likely region for bare language codes, e.g. 'en' → 'US', 'de' → 'DE'.
export function temperatureUnitFromLocale(locale: string): TemperatureUnit {
	try {
		const region = new Intl.Locale(locale).maximize().region
		return region && regionsWithFahrenheitTemperature.includes(region) ? 'f' : 'c'
	} catch {
		// Ignore malformed locales
		return 'c'
	}
}

export const temperatureDescriptionsKeyed = keyBy(temperatureDescriptions, 'id')

export function useTemperatureUnit(
	optionalUnit?: TemperatureUnit,
): [unit: TemperatureUnit, setTemp: (unit: TemperatureUnit) => void] {
	const utils = trpcReact.useUtils()
	const userGetQ = trpcReact.user.get.useQuery()
	const userSetMut = trpcReact.user.set.useMutation({
		onSuccess() {
			utils.user.get.invalidate()
		},
	})

	const setUnit = (temperatureUnit: TemperatureUnit) => {
		userSetMut.mutate({temperatureUnit})
	}

	// Fall back to the unit commonly used in the browser's locale
	const localeUnit = temperatureUnitFromLocale(navigator.language)
	const defaultUnit = optionalUnit || localeUnit

	// Use preferred unit stored on the backend once set
	const preferredUnit = userGetQ.data?.temperatureUnit
	const unit = temperatureDescriptions.some((description) => preferredUnit === description.id)
		? (preferredUnit as TemperatureUnit)
		: defaultUnit

	return [unit, setUnit]
}
