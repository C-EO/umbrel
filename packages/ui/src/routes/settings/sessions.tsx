import type {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {TbChevronLeft, TbDeviceDesktop, TbDeviceMobile, TbHelp, TbLogout} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {finishBrowserLogout} from '@/modules/auth/logout'
import {describeSessionUserAgent, sessionDeviceType} from '@/modules/auth/session-user-agent'
import {useConfirmation} from '@/providers/confirmation'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

type Session = RouterOutput['user']['listSessions'][number]

type SessionsViewProps = {
	onBack?: () => void
	backLabel?: string
	sessions?: Session[]
	isLoading: boolean
	isError: boolean
	isMutating: boolean
	refreshSessions: () => Promise<unknown>
	revokeSession: (sessionId: string) => Promise<{revoked: boolean; revokedCurrent: boolean}>
	revokeOtherSessions?: () => Promise<{revokedCount: number}>
	revokeAllSessions: () => Promise<{revokedCount: number; revokedCurrent: boolean}>
	managedAccountName?: string
}

export function SessionsPanel({onBack, backLabel}: {onBack?: () => void; backLabel?: string}) {
	const utils = trpcReact.useUtils()
	const sessionsQ = trpcReact.user.listSessions.useQuery()
	const revokeSessionMut = trpcReact.user.revokeSession.useMutation()
	const revokeOtherSessionsMut = trpcReact.user.revokeOtherSessions.useMutation()
	const revokeAllSessionsMut = trpcReact.user.revokeAllSessions.useMutation()

	return (
		<SessionsView
			onBack={onBack}
			backLabel={backLabel}
			sessions={sessionsQ.data}
			isLoading={sessionsQ.isLoading}
			isError={sessionsQ.isError}
			isMutating={revokeSessionMut.isPending || revokeOtherSessionsMut.isPending || revokeAllSessionsMut.isPending}
			refreshSessions={() => utils.user.listSessions.invalidate()}
			revokeSession={(sessionId) => revokeSessionMut.mutateAsync({sessionId})}
			revokeOtherSessions={() => revokeOtherSessionsMut.mutateAsync()}
			revokeAllSessions={() => revokeAllSessionsMut.mutateAsync()}
		/>
	)
}

export function ManagedSessionsPanel({
	userId,
	accountName,
	onBack,
}: {
	userId: string
	accountName: string
	onBack: () => void
}) {
	const utils = trpcReact.useUtils()
	const sessionsQ = trpcReact.user.listAccountSessions.useQuery({userId})
	const revokeSessionMut = trpcReact.user.revokeAccountSession.useMutation()
	const revokeAllSessionsMut = trpcReact.user.revokeAllAccountSessions.useMutation()

	return (
		<SessionsView
			onBack={onBack}
			backLabel={accountName}
			sessions={sessionsQ.data}
			isLoading={sessionsQ.isLoading}
			isError={sessionsQ.isError}
			isMutating={revokeSessionMut.isPending || revokeAllSessionsMut.isPending}
			refreshSessions={() => utils.user.listAccountSessions.invalidate({userId})}
			revokeSession={(sessionId) => revokeSessionMut.mutateAsync({userId, sessionId})}
			revokeAllSessions={() => revokeAllSessionsMut.mutateAsync({userId})}
			managedAccountName={accountName}
		/>
	)
}

function SessionsView({
	onBack,
	backLabel,
	sessions,
	isLoading,
	isError,
	isMutating,
	refreshSessions,
	revokeSession: revokeSessionMutation,
	revokeOtherSessions: revokeOtherSessionsMutation,
	revokeAllSessions: revokeAllSessionsMutation,
	managedAccountName,
}: SessionsViewProps) {
	const {t, i18n} = useTranslation()
	const confirm = useConfirmation()

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

	const revokeSession = async (session: Session) => {
		const confirmed = await confirmAction(
			session.current ? t('sessions.revoke-current-confirm-title') : t('sessions.revoke-confirm-title'),
			session.current ? t('sessions.revoke-current-confirm-description') : t('sessions.revoke-confirm-description'),
			t('sessions.revoke'),
		)
		if (!confirmed) return

		try {
			const result = await revokeSessionMutation(session.id)
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
		if (!revokeOtherSessionsMutation) return
		const confirmed = await confirmAction(
			t('sessions.revoke-others-confirm-title'),
			t('sessions.revoke-others-confirm-description'),
			t('sessions.revoke-others'),
		)
		if (!confirmed) return

		try {
			const {revokedCount} = await revokeOtherSessionsMutation()
			await refreshSessions()
			toast.success(t('sessions.revoked-count', {count: revokedCount}))
		} catch {
			toast.error(t('sessions.revoke-error'))
		}
	}

	const revokeAllSessions = async () => {
		const confirmed = await confirmAction(
			t('sessions.revoke-all-confirm-title'),
			managedAccountName
				? t('sessions.managed-revoke-all-confirm-description', {name: managedAccountName})
				: t('sessions.revoke-all-confirm-description'),
			t('sessions.revoke-all'),
		)
		if (!confirmed) return

		try {
			const result = await revokeAllSessionsMutation()
			if (result.revokedCurrent) return finishBrowserLogout()
			await refreshSessions()
			toast.success(t('sessions.revoked-count', {count: result.revokedCount}))
		} catch {
			toast.error(t('sessions.revoke-error'))
		}
	}

	return (
		<div className='flex flex-col gap-4'>
			{onBack && backLabel && <BackButton onClick={onBack}>{backLabel}</BackButton>}
			<div className='space-y-1'>
				<h2 className='text-17 font-semibold -tracking-2'>{t('sessions.title')}</h2>
				<p className='text-13 leading-tight text-white/45'>
					{managedAccountName
						? t('sessions.managed-panel-description', {name: managedAccountName})
						: t('sessions.panel-description')}
				</p>
			</div>

			{isLoading ? (
				<div className='flex min-h-32 items-center justify-center'>
					<Loading>{t('loading')}</Loading>
				</div>
			) : isError ? (
				<div className='rounded-12 bg-white/6 p-4 text-13 text-white/50'>{t('sessions.load-error')}</div>
			) : sessions?.length === 0 ? (
				<div className='rounded-12 bg-white/6 p-4 text-13 text-white/50'>{t('sessions.none')}</div>
			) : (
				<div className='flex flex-col gap-2'>
					{sessions?.map((session) => {
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
				{revokeOtherSessionsMutation && (
					<Button
						className='flex-1'
						size='md-squared'
						variant='default'
						disabled={isMutating || !sessions || sessions.length <= 1}
						onClick={revokeOtherSessions}
					>
						{t('sessions.revoke-others')}
					</Button>
				)}
				<Button
					className='flex-1'
					size='md-squared'
					variant='destructive'
					disabled={isMutating || !sessions?.length}
					onClick={revokeAllSessions}
				>
					<TbLogout className='size-4' />
					{t('sessions.revoke-all')}
				</Button>
			</div>
		</div>
	)
}

export default function SessionsDrawerOrDialog() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const isMobile = useIsMobile()
	const dialogProps = useSettingsDialogProps()
	const onBack = () => navigate('/settings')
	const panel = <SessionsPanel onBack={onBack} backLabel={t('settings')} />

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader className='sr-only'>
						<DrawerTitle>{t('sessions.title')}</DrawerTitle>
					</DrawerHeader>
					<DrawerScroller>
						<div className='px-5 py-6'>{panel}</div>
					</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent showClose>
				<DialogHeader className='sr-only'>
					<DialogTitle>{t('sessions.title')}</DialogTitle>
				</DialogHeader>
				<div className='px-5 py-6'>{panel}</div>
			</DialogScrollableContent>
		</Dialog>
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
