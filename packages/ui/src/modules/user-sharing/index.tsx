import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbInfoCircle} from 'react-icons/tb'

import {Switch} from '@/components/ui/switch'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {cn} from '@/lib/utils'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {OWNER_USER_ID} from '@/modules/auth/constants'
import {trpcReact} from '@/trpc/trpc'

// Shared building blocks for the user-sharing surfaces: the users settings
// dialog and the folder/app share dialogs opened from context menus.

// Whether any member accounts exist — sharing surfaces are hidden without them
export function useHasMembers() {
	const accountsQ = trpcReact.user.listAccounts.useQuery()
	return (accountsQ.data ?? []).some((account) => account.userId !== OWNER_USER_ID)
}

// Share lists cap at ~3.5 rows and scroll so dialogs don't grow unbounded
export const shareListClass = (count: number) =>
	cn('divide-y divide-white/6 rounded-12 bg-white/6', count > 3 ? 'max-h-[196px] overflow-y-auto' : 'overflow-hidden')

// Compact share-all control that sits in a section header next to the Add
// button: small switch, label, and the helper copy tucked into an info tooltip
export function ShareAllToggle({
	label,
	tooltip,
	checked,
	disabled,
	onCheckedChange,
	className,
}: {
	label: string
	tooltip: string
	checked: boolean
	disabled?: boolean
	onCheckedChange: (checked: boolean) => void
	className?: string
}) {
	// Controlled so the info icon also opens on click/tap — Radix tooltips
	// otherwise only respond to hover, which reads as broken on touch
	const [tooltipOpen, setTooltipOpen] = useState(false)
	return (
		<div className={cn('flex h-[25px] items-center gap-1.5', className)}>
			<label className='flex cursor-pointer items-center gap-2'>
				<Switch className='scale-90' checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
				<span className='text-13 font-medium -tracking-2 whitespace-nowrap text-white/90'>{label}</span>
			</label>
			<Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen} delayDuration={150}>
				<TooltipTrigger asChild>
					<button
						type='button'
						onClick={() => setTooltipOpen((open) => !open)}
						className='rounded-full text-white/30 transition-colors hover:text-white/60 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/20'
					>
						<TbInfoCircle className='size-3.5' />
					</button>
				</TooltipTrigger>
				{/* Portaled so the dialog's overflow doesn't clip it */}
				<TooltipPrimitive.Portal>
					<TooltipContent
						side='top'
						collisionPadding={12}
						className='z-50 max-w-60 rounded-8 border-white/10 bg-neutral-800 px-3 py-2 text-center text-12 leading-snug text-white/90 shadow-xl'
					>
						{tooltip}
					</TooltipContent>
				</TooltipPrimitive.Portal>
			</Tooltip>
		</div>
	)
}

// Full-width switch row with title + helper copy, used as the "share with
// everyone" card in the folder/app share dialogs
export function ShareEveryoneRow({
	title,
	description,
	checked,
	disabled,
	onCheckedChange,
	className,
}: {
	title: string
	description: string
	checked: boolean
	disabled?: boolean
	onCheckedChange: (checked: boolean) => void
	className?: string
}) {
	return (
		<label className={cn('flex items-center justify-between gap-4 py-1', className)}>
			<div className='min-w-0 flex-1'>
				<div className='text-13 font-medium -tracking-2 text-white/90'>{title}</div>
				<div className='text-12 leading-tight text-white/35'>{description}</div>
			</div>
			<Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
		</label>
	)
}

export function EmptyCard({children}: {children: React.ReactNode}) {
	return (
		<div className='grid min-h-16 place-items-center rounded-12 bg-white/6 px-4 py-5 text-center text-13 text-white/40'>
			{children}
		</div>
	)
}

// The body shared by the folder and app share dialogs: an "everyone" toggle
// plus per-member switches. Calls onChange with the new sharedWith value; an
// empty selection means unshare.
export function MemberSharePicker({
	sharedWith,
	isBusy,
	onChange,
}: {
	sharedWith: 'all' | string[] | undefined
	isBusy: boolean
	onChange: (sharedWith: 'all' | string[]) => void
}) {
	const {t} = useTranslation()
	const accountsQ = trpcReact.user.listAccounts.useQuery()
	const members = (accountsQ.data ?? []).filter((account) => account.userId !== OWNER_USER_ID)

	const everyone = sharedWith === 'all'
	const selectedUserIds = Array.isArray(sharedWith) ? sharedWith : []
	// Also disabled until accounts resolve: turning "everyone" off materializes
	// to the member list, which would wrongly unshare while it's still empty
	const disabled = isBusy || !accountsQ.data

	const toggleUser = (userId: string) => {
		onChange(
			selectedUserIds.includes(userId) ? selectedUserIds.filter((id) => id !== userId) : [...selectedUserIds, userId],
		)
	}

	return (
		<>
			<ShareEveryoneRow
				className='rounded-12 bg-white/6 p-3'
				title={t('users.share-with-everyone')}
				description={t('users.share-with-everyone-description')}
				checked={everyone}
				disabled={disabled}
				// Turning everyone off materializes to the current members so nobody
				// loses access until they're unchecked individually
				onCheckedChange={(checked) => onChange(checked ? 'all' : members.map((member) => member.userId))}
			/>

			{!everyone && (
				<div className='flex flex-col gap-2'>
					<div className='text-13 font-medium -tracking-2 text-white/90'>{t('users.share-specific-members')}</div>
					{members.length > 0 ? (
						<div className={shareListClass(members.length)}>
							{members.map((member) => (
								<label
									key={member.userId}
									className='flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-white/4'
								>
									<AccountAvatar name={member.name} userId={member.userId} size={28} />
									<span className='min-w-0 flex-1 truncate text-14 font-medium -tracking-2 text-white/90'>
										{member.name}
									</span>
									<Switch
										checked={selectedUserIds.includes(member.userId)}
										disabled={disabled}
										onCheckedChange={() => toggleUser(member.userId)}
									/>
								</label>
							))}
						</div>
					) : (
						accountsQ.data && <EmptyCard>{t('users.no-members')}</EmptyCard>
					)}
				</div>
			)}
		</>
	)
}
