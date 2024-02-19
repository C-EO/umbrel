import {useId} from 'react'

import {listClass, ListRadioItem} from '@/components/ui/list'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {languages, useLanguage} from '@/hooks/use-language'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'
import {sleep} from '@/utils/misc'

export function LanguageDrawer() {
	const title = t('language')
	const dialogProps = useDialogOpenProps('language')
	const [activeCode, setActiveCode] = useLanguage()

	const changeLanguage = async (code: string) => {
		setActiveCode(code)
		// Delay so user can see the checkmark
		await sleep(200)
		dialogProps.onOpenChange(false)
	}

	const radioName = useId()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader>
					<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('language.select-description')}</DrawerDescription>
				</DrawerHeader>

				<div className={listClass}>
					{languages.map(({code, name}) => (
						<ListRadioItem
							key={code}
							name={radioName}
							checked={activeCode === code}
							onSelect={() => changeLanguage(code)}
						>
							{name}
						</ListRadioItem>
					))}
				</div>

				{/* Spacing to match figma */}
				<div className='h-[80px]' />
				{/* empty `DrawerFooter` adding bottom spacing */}
				<DrawerFooter></DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}
