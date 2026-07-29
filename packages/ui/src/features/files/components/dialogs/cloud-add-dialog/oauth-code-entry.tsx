import {useTranslation} from 'react-i18next'

import {Input} from '@/components/ui/input'

export function OAuthCodeEntry({
	providerName,
	code,
	disabled = false,
	onCodeChange,
	onSubmit,
}: {
	providerName: string
	code: string
	disabled?: boolean
	onCodeChange: (code: string) => void
	onSubmit: (code: string) => void
}) {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col items-center gap-4 py-2 text-center'>
			<p className='max-w-[340px] text-13 leading-relaxed text-white/60'>
				{t('files-cloud.oauth-code-description', {provider: providerName})}
			</p>
			<Input
				autoFocus
				autoComplete='off'
				spellCheck={false}
				value={code}
				disabled={disabled}
				onValueChange={onCodeChange}
				onKeyDown={(event) => {
					if (!disabled && event.key === 'Enter' && code.trim()) onSubmit(code)
				}}
				onPaste={(event) => {
					if (disabled) return
					// A pasted full code submits immediately; short fragments fall through
					// to normal input handling
					const pasted = event.clipboardData.getData('text').trim()
					if (pasted.length >= 8) {
						event.preventDefault()
						onCodeChange(pasted)
						onSubmit(pasted)
					}
				}}
				placeholder={t('files-cloud.oauth-code-placeholder')}
				className='font-mono text-13'
			/>
		</div>
	)
}
