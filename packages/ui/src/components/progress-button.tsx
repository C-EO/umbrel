import {VariantProps} from 'class-variance-authority'
import {ButtonHTMLAttributes, CSSProperties, useEffect, useState} from 'react'
import {arrayIncludes} from 'ts-extras'

import {buttonVariants} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import {AppStateOrLoading, progressBarStates} from '@/trpc/trpc'

// Check if CSS available
// https://developer.mozilla.org/en-US/docs/Web/API/CSS/registerProperty
if (typeof CSS !== 'undefined' && CSS.registerProperty) {
	CSS.registerProperty({
		name: '--progress-button-progress',
		syntax: '<percentage>',
		inherits: false,
		initialValue: '0%',
	})
}

type Props = {
	progress?: number
	state: AppStateOrLoading
} & VariantProps<typeof buttonVariants> &
	ButtonHTMLAttributes<HTMLButtonElement>

/**
 * An app action button (Install / Open / Update…) whose background can fill
 * with live progress during a transition. Deliberately a plain, intrinsically
 * sized button: the label crossfades via CSS and progress is a custom property,
 * so grids can render many instances without layout measurement observers.
 */
export function ProgressButton({variant, size, progress, state, children, className, style, ...buttonProps}: Props) {
	const progressing = arrayIncludes(progressBarStates, state)

	// Stops flicker when progressing done
	const [progressingDone, setProgressingDone] = useState(true)
	useEffect(() => {
		if (state === 'ready') {
			setTimeout(() => setProgressingDone(true), 0)
		} else if (progressing) {
			setProgressingDone(false)
		}
	}, [state, progressing])

	const progressingStyle: CSSProperties = {
		transition: '--progress-button-progress 0.3s',
		['--progress-button-progress' as string]: `${Math.round(progress ?? 0)}%`,
		backgroundImage:
			'linear-gradient(to right, var(--progress-button-bg) var(--progress-button-progress), transparent var(--progress-button-progress))',
		backgroundColor: 'color-mix(in srgb, var(--progress-button-bg) 60%, transparent)',
		opacity: 1,
	}

	return (
		<button
			data-progressing={progressing}
			className={cn(
				buttonVariants({size, variant}),
				'overflow-hidden whitespace-nowrap transition-[background-color,opacity] duration-300 ease-out disabled:opacity-60',
				state === 'loading' && '!bg-white/10',
				// Disable transition right when installing done for a sec to prevent flicker
				state === 'ready' && !progressingDone && 'transition-none',
				className,
			)}
			style={{
				...(progressing ? progressingStyle : undefined),
				...style,
			}}
			{...buttonProps}
			disabled={isProgressButtonDisabled(state, buttonProps.disabled)}
		>
			{/* Stable intrinsic wrapper; the keyed child re-fades when state changes */}
			<span className='flex w-max items-center'>
				<span key={state} className='flex animate-in items-center duration-200 fade-in'>
					{children}
				</span>
			</span>
		</button>
	)
}

/** Loading and lifecycle transitions are never interactive, regardless of caller props. */
export function isProgressButtonDisabled(state: AppStateOrLoading, callerDisabled = false) {
	return (
		callerDisabled ||
		arrayIncludes(
			['loading', 'installing', 'updating', 'uninstalling', 'starting', 'restarting', 'stopping'] as const,
			state,
		)
	)
}
