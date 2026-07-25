import {Loader2} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {PasswordInput} from '@/components/ui/input'
import {formGroupClass, primaryButtonProps, SubTitle, Title} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {type Account} from '@/modules/auth/use-account-picker'
import {firstNameFromFullName} from '@/utils/misc'

// Greeting + password form shared by the lock screen (single-account and
// post-selection dock states) and the app proxy login page. Pure props — no
// tRPC/providers — so app-auth can bundle it. The proxy page overrides the
// subtitle/labels to say "Umbrel password ... to open {app}", the guard
// against users typing the app's own password here.
export function LoginForm({
	account,
	password,
	onPasswordChange,
	error,
	isPending,
	onSubmit,
	subtitle,
	submitLabel,
}: {
	account?: Account
	password: string
	onPasswordChange: (password: string) => void
	error?: string
	isPending: boolean
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
	subtitle?: string
	submitLabel?: string
}) {
	const {t} = useTranslation()
	return (
		<>
			<div className='flex flex-col items-center gap-1.5'>
				<Title>
					<span style={{fontFamily: "'SF Pro Rounded', ui-rounded, 'Inter', system-ui, sans-serif"}}>
						{account ? (
							<>
								{/* On desktop the greeting carries the name; on mobile it lives
								    by the avatar/caption instead so the greeting never wraps */}
								<span className='md:hidden'>{t('login.greeting-short')}</span>
								<span className='hidden md:inline'>
									{t('login.greeting', {name: firstNameFromFullName(account.name)})}
								</span>
							</>
						) : (
							t('login.title')
						)}
					</span>
				</Title>
				<SubTitle>{subtitle ?? t('login.subtitle')}</SubTitle>
			</div>
			<form className='flex w-full flex-col items-center gap-5 px-4 md:px-0' onSubmit={onSubmit}>
				<div className={cn(formGroupClass, 'max-w-[320px] [&_input]:bg-slate-500/15 [&_input]:backdrop-blur-xl')}>
					<PasswordInput
						label={t('login.password-label')}
						autoFocus
						value={password}
						onValueChange={onPasswordChange}
						error={error}
					/>
				</div>
				<button
					type='submit'
					{...primaryButtonProps}
					// Stays solid white through hover/active/pending — no dimming
					className={cn(
						primaryButtonProps.className,
						'relative bg-white hover:bg-white active:bg-white disabled:opacity-100',
					)}
					disabled={isPending}
				>
					<span className={cn(isPending && 'opacity-0')}>{submitLabel ?? t('login.password.submit')}</span>
					{isPending && <Loader2 className='absolute size-4 animate-spin' />}
				</button>
			</form>
		</>
	)
}
