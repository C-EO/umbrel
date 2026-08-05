import {useId} from 'react'
import {useTranslation} from 'react-i18next'

import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {ListRadioItem} from '@/components/ui/list'
import {useLanguage} from '@/hooks/use-language'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {languages} from '@/utils/language'

export function LanguageDrawer() {
	const {t} = useTranslation()
	const title = t('settings.language')
	const dialogProps = useSettingsDialogProps()
	const [activeCode, setActiveCode] = useLanguage()

	const languageRadioName = useId()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('settings.language-description')}</DrawerDescription>
				</DrawerHeader>

				<DrawerScroller>
					<section className='flex flex-col gap-2'>
						<div className='divide-y divide-white/6 rounded-12 bg-white/6'>
							{languages.map(({code, name, glyph}) => (
								<ListRadioItem
									key={code}
									name={languageRadioName}
									checked={activeCode === code}
									onSelect={() => setActiveCode(code)}
								>
									<span className='flex items-center gap-3'>
										<span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-5 bg-white/10 text-12 leading-none font-semibold'>
											{glyph}
										</span>
										{name}
									</span>
								</ListRadioItem>
							))}
						</div>
					</section>
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}
