import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {cn} from '@/lib/utils'

// Chat message bubbles, vendored from the shadcn registry (ui.shadcn.com/docs/
// components/base/bubble) with its API kept intact — Bubble, BubbleContent,
// BubbleReactions, BubbleGroup and their variant/align/side props — but the
// visual layer reimplemented in house Tailwind: the upstream styling lives in
// shadcn's cn-* CSS distribution that only ships with new-style scaffolds (the
// registry item itself isn't published for the CLI yet). Variants beyond the
// three used so far can be filled in from upstream as needed.

function BubbleGroup({className, ...props}: React.ComponentProps<'div'>) {
	return <div data-slot='bubble-group' className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props} />
}

const bubbleVariants = cva('group/bubble relative flex w-fit min-w-0 flex-col rounded-2xl text-13 leading-snug', {
	variants: {
		variant: {
			default: 'bg-[#0a84ff] text-white',
			secondary: 'bg-white/8 text-white/90',
			muted: 'bg-white/5 text-white/60',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
})

// The sender-side corner tightens into a tail: end-aligned bubbles sit on the
// right with the bottom-right corner pinched, start-aligned mirror it
function Bubble({
	variant = 'default',
	align = 'start',
	className,
	...props
}: React.ComponentProps<'div'> & VariantProps<typeof bubbleVariants> & {align?: 'start' | 'end'}) {
	return (
		<div
			data-slot='bubble'
			data-variant={variant}
			data-align={align}
			className={cn(
				bubbleVariants({variant}),
				align === 'end' ? 'self-end rounded-ee-[5px]' : 'self-start rounded-es-[5px]',
				className,
			)}
			{...props}
		/>
	)
}

function BubbleContent({asChild = false, className, ...props}: React.ComponentProps<'div'> & {asChild?: boolean}) {
	const Comp = asChild ? Slot : 'div'
	return (
		<Comp
			data-slot='bubble-content'
			className={cn('w-fit max-w-full min-w-0 px-3 py-2 text-balance wrap-break-word', className)}
			{...props}
		/>
	)
}

const bubbleReactionsVariants = cva('absolute z-10 flex w-fit items-center justify-center', {
	variants: {
		side: {
			top: '-top-3',
			bottom: '-bottom-3',
		},
		align: {
			start: '-left-1.5',
			end: '-right-1.5',
		},
	},
	defaultVariants: {
		side: 'bottom',
		align: 'end',
	},
})

// Positions reaction chips overlapping a bubble corner, tapback style. The
// chips themselves are the children, so their look (and any animation) stays
// with the caller.
function BubbleReactions({
	side = 'bottom',
	align = 'end',
	className,
	...props
}: React.ComponentProps<'div'> & {side?: 'top' | 'bottom'; align?: 'start' | 'end'}) {
	return (
		<div
			data-slot='bubble-reactions'
			data-side={side}
			data-align={align}
			className={cn(bubbleReactionsVariants({side, align}), className)}
			{...props}
		/>
	)
}

export {Bubble, BubbleContent, BubbleGroup, BubbleReactions}
