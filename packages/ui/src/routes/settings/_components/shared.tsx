import {motion, useReducedMotion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {RiAlarmWarningFill} from 'react-icons/ri'
import {TbChevronLeft} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
import {AccountAvatarEditor, type AccountAvatarControlsVisibility} from '@/modules/auth/account-avatar-editor'
import {afterDelayedClose} from '@/utils/dialog'
import {tw} from '@/utils/tw'

export const cardErrorClass = tw`text-14 font-medium -tracking-3 animate-pulse leading-snug text-destructive2-lightest`

export function SettingsAccountAvatar({
	name,
	userId,
	avatarUrl,
	controlsVisibility,
}: {
	name: string
	userId: string
	avatarUrl?: string
	controlsVisibility: AccountAvatarControlsVisibility
}) {
	const reduceMotion = Boolean(useReducedMotion())

	return (
		<motion.div
			className='absolute -bottom-3 -left-3 z-20 rounded-full border border-white/25 bg-black/20 p-1 shadow-[0_8px_20px_rgba(0,0,0,0.45)] backdrop-blur-sm will-change-transform'
			whileHover={reduceMotion ? undefined : {scale: 1.08}}
			transition={{type: 'spring', duration: 0.18, bounce: 0.12}}
		>
			<AccountAvatarEditor
				account={{name, userId, avatarUrl}}
				size={48}
				controlsVisibility={controlsVisibility}
				controlsOffset='wide'
			/>
		</motion.div>
	)
}

export function ChangePasswordWarning() {
	const {t} = useTranslation()
	return <ErrorAlert icon={RiAlarmWarningFill} description={t('change-password.callout')} />
}

export function BackButton({onClick, children}: {onClick: () => void; children: React.ReactNode}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className='-ml-1 flex items-center gap-0.5 self-start text-13 font-medium -tracking-2 text-white/50 transition-colors hover:text-white/70'
		>
			<TbChevronLeft className='size-4' />
			{children}
		</button>
	)
}

export function SectionLabel({children}: {children: React.ReactNode}) {
	return <div className='text-12 font-semibold tracking-wide text-white/40 uppercase'>{children}</div>
}

export function Divider() {
	return <div className='h-px bg-white/5' />
}

export function useSettingsDialogProps({closeTo = '/settings'}: {closeTo?: string} = {}) {
	const navigate = useNavigate()

	const [open, setOpen] = useState(true)

	return {
		open,
		onOpenChange: (open: boolean) => {
			setOpen(open)
			afterDelayedClose(() => navigate(closeTo))(open)
		},
	}
}
