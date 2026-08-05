import {motion, useReducedMotion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {RiAlarmWarningFill} from 'react-icons/ri'
import {Link, useNavigate} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {afterDelayedClose} from '@/utils/dialog'
import {tw} from '@/utils/tw'

export const cardErrorClass = tw`text-14 font-medium -tracking-3 animate-pulse leading-snug text-destructive2-lightest`

export function SettingsAccountAvatarLink({name, userId, isMember}: {name: string; userId: string; isMember: boolean}) {
	const {t} = useTranslation()
	const reduceMotion = Boolean(useReducedMotion())
	const label = isMember ? t('change-name') : t('account')

	return (
		<Link
			to={isMember ? '/settings/account/change-name' : '/settings/users?ownerPanel=overview'}
			aria-label={label}
			title={label}
			className='group absolute -bottom-3 -left-3 z-20 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40'
		>
			<motion.span
				className='relative block rounded-full border border-white/25 bg-black/20 p-1 shadow-[0_8px_20px_rgba(0,0,0,0.45)] backdrop-blur-sm will-change-transform'
				whileHover={reduceMotion ? undefined : {scale: 1.05}}
				whileTap={reduceMotion ? undefined : {scale: 0.96}}
				transition={{type: 'spring', duration: 0.18, bounce: 0.12}}
			>
				<AccountAvatar name={name} userId={userId} size={48} />
				<span className='pointer-events-none absolute inset-0 rounded-full border border-white/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none' />
			</motion.span>
		</Link>
	)
}

export function ChangePasswordWarning() {
	const {t} = useTranslation()
	return <ErrorAlert icon={RiAlarmWarningFill} description={t('change-password.callout')} />
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
