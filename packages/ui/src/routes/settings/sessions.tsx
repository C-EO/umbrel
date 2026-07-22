import type {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {TbChevronLeft, TbDeviceDesktop, TbDeviceMobile, TbHelp, TbLogout} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {finishBrowserLogout} from '@/modules/auth/logout'
import {describeSessionUserAgent, sessionDeviceType} from '@/modules/auth/session-user-agent'
import {useConfirmation} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'

export function SessionsPanel({onBack}: {onBack: () => void}) {
	const {t, i18n} = useTranslation()
	const confirm = useConfirmation()
	const utils = trpcReact.useUtils()
	const sessionsQ = trpcReact.user.listSessions.useQuery()
	const revokeSessionMut = trpcReact.user.revokeSession.useMutation()
	const revokeOtherSessionsMut = trpcReact.user.revokeOtherSessions.useMutation()
	const revokeAllSessionsMut = trpcReact.user.revokeAllSessions.useMutation()
	const isMutating = revokeSessionMut.isPending || revokeOtherSessionsMut.isPending || revokeAllSessionsMut.isPending

	const refreshSessions = () => utils.user.listSessions.invalidate()

	const confirmAction = async (title: string, message: string, action: string) => {
		try {
			const result = await confirm({
				title,
				message,
				actions: [
					{label: action, value: 'confirm', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			return result.actionValue === 'confirm'
		} catch {
			return false
		}
	}

	const revokeSession = async (session: NonNullable<typeof sessionsQ.data>[number]) => {
		const confirmed = await confirmAction(
			session.current ? t('sessions.revoke-current-confirm-title') : t('sessions.revoke-confirm-title'),
			session.current ? t('sessions.revoke-current-confirm-description') : t('sessions.revoke-confirm-description'),
			t('sessions.revoke'),
		)
		if (!confirmed) return

		try {
			const result = await revokeSessionMut.mutateAsync({sessionId: session.id})
			if (result.revokedCurrent) return finishBrowserLogout()
			if (!result.revoked) throw new Error('Session no longer exists')
			await refreshSessions()
			toast.success(t('sessions.revoked'))
		} catch {
			toast.error(t('sessions.revoke-error'))
			await refreshSessions()
		}
	}

	const revokeOtherSessions = async () => {
		const confirmed = await confirmAction(
			t('sessions.revoke-others-confirm-title'),
			t('sessions.revoke-others-confirm-description'),
			t('sessions.revoke-others'),
		)
		if (!confirmed) return

		try {
			const {revokedCount} = await revokeOtherSessionsMut.mutateAsync()
			await refreshSessions()
			toast.success(t('sessions.revoked-count', {count: revokedCount}))
		} catch {
			toast.error(t('sessions.revoke-error'))
		}
	}

	const revokeAllSessions = async () => {
		const confirmed = await confirmAction(
			t('sessions.revoke-all-confirm-title'),
			t('sessions.revoke-all-confirm-description'),
			t('sessions.revoke-all'),
		)
		if (!confirmed) return

		try {
			const result = await revokeAllSessionsMut.mutateAsync()
			if (result.revokedCurrent) finishBrowserLogout()
		} catch {
			toast.error(t('sessions.revoke-error'))
		}
	}

	return (
		<div className='flex flex-col gap-4'>
			<BackButton onClick={onBack}>{t('advanced-settings')}</BackButton>
			<div className='space-y-1'>
				<h2 className='text-17 font-semibold -tracking-2'>{t('sessions.title')}</h2>
				<p className='text-13 leading-tight text-white/45'>{t('sessions.panel-description')}</p>
			</div>

			{sessionsQ.isLoading ? (
				<div className='flex min-h-32 items-center justify-center'>
					<Loading>{t('loading')}</Loading>
				</div>
			) : sessionsQ.isError ? (
				<div className='rounded-12 bg-white/6 p-4 text-13 text-white/50'>{t('sessions.load-error')}</div>
			) : (
				<div className='flex flex-col gap-2'>
					{sessionsQ.data?.map((session) => {
						const deviceType = sessionDeviceType(session.userAgent)
						const DeviceIcon =
							deviceType === 'mobile' ? TbDeviceMobile : deviceType === 'desktop' ? TbDeviceDesktop : TbHelp
						const description = describeSessionUserAgent(session.userAgent) ?? t('sessions.unknown-device')

						return (
							<div key={session.id} className='flex items-start gap-3 rounded-12 bg-white/6 p-3.5'>
								<div className='grid size-9 shrink-0 place-items-center rounded-8 bg-white/6'>
									<DeviceIcon className='size-5 text-white/60' />
								</div>
								<div className='min-w-0 flex-1 space-y-1' title={session.userAgent}>
									<div className='flex flex-wrap items-center gap-1.5'>
										<h3 className='text-13 leading-tight font-medium'>{description}</h3>
										{session.current && (
											<span className='text-10 rounded-full bg-brand/20 px-1.5 py-0.5 font-medium text-brand-lightest'>
												{t('sessions.current')}
											</span>
										)}
									</div>
									<p className='text-11 leading-tight text-white/35'>
										{t('sessions.created', {
											date: formatDate(session.createdAt, i18n.resolvedLanguage ?? i18n.language),
										})}
									</p>
									<p className='text-11 leading-tight text-white/35'>
										{t('sessions.last-seen', {
											date: formatDate(session.lastSeenAt, i18n.resolvedLanguage ?? i18n.language),
										})}
									</p>
								</div>
								<Button size='sm' variant='destructive' disabled={isMutating} onClick={() => revokeSession(session)}>
									{t('sessions.revoke')}
								</Button>
							</div>
						)
					})}
				</div>
			)}

			<div className='mt-1 flex flex-col gap-2 border-t border-white/6 pt-4 sm:flex-row'>
				<Button
					className='flex-1'
					size='md-squared'
					variant='default'
					disabled={isMutating || !sessionsQ.data || sessionsQ.data.length <= 1}
					onClick={revokeOtherSessions}
				>
					{t('sessions.revoke-others')}
				</Button>
				<Button
					className='flex-1'
					size='md-squared'
					variant='destructive'
					disabled={isMutating || !sessionsQ.data?.length}
					onClick={revokeAllSessions}
				>
					<TbLogout className='size-4' />
					{t('sessions.revoke-all')}
				</Button>
			</div>
		</div>
	)
}

function BackButton({onClick, children}: {onClick: () => void; children: ReactNode}) {
	return (
		<button
			onClick={onClick}
			className='-ml-1 flex items-center gap-0.5 self-start text-13 font-medium -tracking-2 text-white/50 transition-colors hover:text-white/70'
		>
			<TbChevronLeft className='size-4' />
			{children}
		</button>
	)
}

function formatDate(timestamp: number, locale: string) {
	try {
		return new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'}).format(timestamp)
	} catch {
		return new Date(timestamp).toLocaleString()
	}
}
