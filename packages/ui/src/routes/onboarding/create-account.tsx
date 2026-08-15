import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {AnimatedInputError, Input, PasswordInput} from '@/components/ui/input'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {formGroupClass, Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'
import {trpcReact} from '@/trpc/trpc'

import {getGenericRaidOnboardingPath} from './storage-selection'

// Credentials for RAID onboarding flows. Passed via React Router's location.state
// through the RAID setup pages. Actual user.register call happens in setup.tsx
// after RAID configuration. location.state survives page refresh but is lost on
// direct URL navigation or new tab.
export type AccountCredentials = {
	name: string
	password: string
	language: string
}

export default function CreateAccount() {
	const {t} = useTranslation()
	const title = t('onboarding.create-account')
	const navigate = useNavigate()
	const auth = useAuth()
	const [language] = useLanguage()
	const {data: deviceInfo, isLoading: isDeviceInfoLoading} = useDeviceInfo()

	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [localError, setLocalError] = useState('')
	const [isNavigating, setIsNavigating] = useState(false)
	const [showExternalDriveConfirmation, setShowExternalDriveConfirmation] = useState(false)

	const isPro = deviceInfo?.umbrelHostEnvironment === 'umbrel-pro'
	const isRaspberryPi = deviceInfo?.umbrelHostEnvironment === 'raspberry-pi'
	const isGeneric = deviceInfo?.umbrelHostEnvironment === 'unknown'
	const externalDevicesQ = trpcReact.files.externalDevices.useQuery(undefined, {enabled: isRaspberryPi})
	// Generic devices with internal data drives get the matching RAID onboarding flow
	const internalStorageQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {enabled: isGeneric})

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: async (token) => {
			setIsNavigating(true)
			auth.signUpWithToken(token, '/onboarding/account-created')
		},
	})

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: async () => loginMut.mutate({password, totpToken: ''}),
	})

	const completeAccountSetup = async () => {
		if (isPro) {
			// For Umbrel Pro we navigate to RAID setup
			setIsNavigating(true)
			const credentials: AccountCredentials = {name, password, language}

			// Pass credentials to RAID setup page
			navigate('/onboarding/raid', {state: {credentials}})
			return
		}

		if (isGeneric) {
			// Generic devices prefer HDD RAID when HDDs are present, otherwise SSD RAID
			// when SSDs are present. If detection fails we fall back to standard setup.
			const internalDevices = internalStorageQ.data ?? (await internalStorageQ.refetch()).data
			const raidOnboardingPath = getGenericRaidOnboardingPath(internalDevices ?? [])
			if (raidOnboardingPath) {
				setIsNavigating(true)
				const credentials: AccountCredentials = {name, password, language}
				navigate(raidOnboardingPath, {state: {credentials}})
				return
			}
		}

		// Otherwise we do standard registration flow
		registerMut.mutate({name, password, language})
	}

	const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		registerMut.reset()
		setLocalError('')

		if (!name) {
			setLocalError(t('onboarding.create-account.failed.name-required'))
			return
		}

		if (password !== confirmPassword) {
			setLocalError(t('onboarding.create-account.failed.passwords-dont-match'))
			return
		}

		if (password.length < 6) {
			setLocalError(t('change-password.failed.min-length', {characters: 6}))
			return
		}

		const externalDevices = isRaspberryPi
			? (externalDevicesQ.data ?? (await externalDevicesQ.refetch()).data)
			: undefined
		if (externalDevices?.length) {
			setShowExternalDriveConfirmation(true)
			return
		}

		completeAccountSetup()
	}

	const remoteFormError = !registerMut.error?.data?.zodError && registerMut.error?.message
	const formError = localError || remoteFormError
	const isLoading = isDeviceInfoLoading || registerMut.isPending || loginMut.isPending || isNavigating

	return (
		<Layout
			title={title}
			subTitle={t('onboarding.create-account.subtitle')}
			subTitleMaxWidth={630}
			footer={<OnboardingFooter action={OnboardingAction.RESTORE} />}
		>
			<form onSubmit={onSubmit} className='w-full'>
				<fieldset disabled={isLoading} className='flex flex-col items-center gap-5'>
					<div className={formGroupClass}>
						<Input
							placeholder={t('onboarding.create-account.name.input-placeholder')}
							autoFocus
							value={name}
							onValueChange={setName}
						/>
						<PasswordInput
							label={t('onboarding.create-account.password.input-label')}
							value={password}
							onValueChange={setPassword}
							error={registerMut.error?.data?.zodError?.fieldErrors['password']?.join('. ')}
						/>
						<PasswordInput
							label={t('onboarding.create-account.confirm-password.input-label')}
							value={confirmPassword}
							onValueChange={setConfirmPassword}
						/>
					</div>

					<div className='-my-2.5'>
						<AnimatedInputError>{formError}</AnimatedInputError>
					</div>
					<button type='submit' {...primaryButtonProps}>
						{isLoading ? t('onboarding.create-account.submitting') : t('onboarding.create-account.submit')}
					</button>
				</fieldset>
			</form>

			<AlertDialog open={showExternalDriveConfirmation} onOpenChange={setShowExternalDriveConfirmation}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('onboarding.create-account.external-drive.title')}</AlertDialogTitle>
						<AlertDialogDescription className='space-y-3'>
							<span className='block'>{t('onboarding.create-account.external-drive.description')}</span>
							<span className='block'>{t('onboarding.create-account.external-drive.main-storage')}</span>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t('onboarding.create-account.external-drive.go-back')}</AlertDialogCancel>
						<AlertDialogAction onClick={completeAccountSetup}>
							{t('onboarding.create-account.external-drive.continue')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Layout>
	)
}
