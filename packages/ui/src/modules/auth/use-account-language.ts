import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'
import {arrayIncludes} from 'ts-extras'

import {supportedLanguageCodes} from '@/utils/language'

/** Keeps the pre-login UI in the currently selected account's language. */
export function useAccountLanguage(language: string | undefined) {
	const {i18n} = useTranslation()

	useEffect(() => {
		if (arrayIncludes(supportedLanguageCodes, language) && language !== i18n.language) {
			i18n.changeLanguage(language)
		}
	}, [i18n, i18n.language, language])
}
