// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {useAccountLanguage} from '@/modules/auth/use-account-language'

const i18n = vi.hoisted(() => ({
	language: 'en',
	changeLanguage: vi.fn((language: string) => {
		i18n.language = language
		return Promise.resolve()
	}),
}))

vi.mock('react-i18next', () => ({useTranslation: () => ({i18n})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function AccountLanguage({language}: {language?: string}) {
	useAccountLanguage(language)
	return null
}

function renderAccountLanguage(language?: string) {
	const container = document.createElement('div')
	const root = createRoot(container)
	act(() => root.render(<AccountLanguage language={language} />))
	return {
		rerender: (nextLanguage?: string) => act(() => root.render(<AccountLanguage language={nextLanguage} />)),
		unmount: () => act(() => root.unmount()),
	}
}

afterEach(() => {
	i18n.language = 'en'
	i18n.changeLanguage.mockClear()
})

describe('useAccountLanguage', () => {
	it("switches to each selected account's supported language", () => {
		const view = renderAccountLanguage('en')
		expect(i18n.changeLanguage).not.toHaveBeenCalled()

		view.rerender('fr')
		expect(i18n.changeLanguage).toHaveBeenLastCalledWith('fr')

		view.rerender('de')
		expect(i18n.changeLanguage).toHaveBeenLastCalledWith('de')
		expect(i18n.changeLanguage).toHaveBeenCalledTimes(2)
		view.unmount()
	})

	it('ignores missing and unsupported account languages', () => {
		const view = renderAccountLanguage()
		view.rerender('not-a-language')

		expect(i18n.changeLanguage).not.toHaveBeenCalled()
		view.unmount()
	})
})
