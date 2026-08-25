import {format, formatDistanceToNowStrict} from 'date-fns'
import {motion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import type {ReleaseTimelineEntry} from '@/features/app-store/data/releases'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'
import {languageCodeToDateLocale} from '@/utils/date-time'

import {appPageSectionLabelClass, expandTransition, ReadMoreMarkdownSection} from './shared'

/**
 * "What's new" as a vertical release timeline (the apps.umbrel.com design):
 * a hairline spine with a dot per release — the newest one lit up and
 * rippling — version rows that expand into their notes, and relative dates.
 */
export function ReleaseTimeline({
	entries,
	highlightLatest = false,
}: {
	entries: ReleaseTimelineEntry[]
	/** Marks the newest entry as an available update for this device */
	highlightLatest?: boolean
}) {
	const {t} = useTranslation()
	// One entry open at a time, like an accordion: opening a release folds the
	// previous one away. The newest release starts open.
	const [openVersion, setOpenVersion] = useState<string | null>(entries[0]?.version ?? null)

	// Callers gate on hasTimelineContent; this is just a safety net
	if (!entries.length) return null

	return (
		<section>
			<p className={cn(appPageSectionLabelClass, 'mb-4')}>{t('app-page.section.release-notes.title')}</p>
			<div
				className={cn(
					'relative pl-7',
					// The spine only makes sense when it has releases to connect
					entries.length > 1 &&
						'before:absolute before:top-3.5 before:bottom-3 before:left-[7px] before:w-px before:bg-white/10',
				)}
			>
				{entries.map((entry, index) => (
					<TimelineRelease
						key={entry.version}
						entry={entry}
						latest={index === 0}
						highlight={index === 0 && highlightLatest}
						open={entry.version === openVersion}
						onToggle={() => setOpenVersion((current) => (current === entry.version ? null : entry.version))}
					/>
				))}
			</div>
		</section>
	)
}

function TimelineRelease({
	entry,
	latest,
	highlight,
	open,
	onToggle,
}: {
	entry: ReleaseTimelineEntry
	latest: boolean
	highlight: boolean
	open: boolean
	onToggle: () => void
}) {
	const {t} = useTranslation()
	const hasNotes = Boolean(entry.notes.trim())

	return (
		<div className='group relative mb-4.5 last:mb-0'>
			{/* Timeline dot, centered on the spine and on the version row's text
			    line (the row is 30px tall, so its center sits at 15px); the newest
			    release glows and ripples, older dots are opaque so the spine
			    doesn't show through them */}
			<span
				aria-hidden
				className={cn(
					'absolute rounded-full',
					latest
						? 'top-2 -left-7 h-3.5 w-3.5 bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.25),0_0_0_5px_rgba(255,255,255,0.08)] after:absolute after:inset-0 after:rounded-full after:border after:border-white/60 after:content-[""] motion-safe:after:animate-[umbrel-ripple_2.4s_ease-out_infinite]'
						: 'top-2.5 left-[-26px] h-2.5 w-2.5 bg-zinc-600',
				)}
			/>
			<button
				className={cn(
					'flex min-h-[30px] w-full items-center justify-between gap-4 rounded-8 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-white/20',
					!hasNotes && 'pointer-events-none',
				)}
				onClick={onToggle}
				aria-expanded={hasNotes ? open : undefined}
				disabled={!hasNotes}
			>
				<span
					className={cn(
						'inline-flex min-w-0 items-center gap-2 text-15 font-semibold transition-colors',
						hasNotes && 'group-hover:text-brand-lightest',
					)}
				>
					<span className='truncate'>{t('app-page.section.release-notes.version', {version: entry.version})}</span>
					{highlight && (
						<span className='rounded-full bg-brand/20 px-2 py-0.5 text-11 leading-tight font-medium whitespace-nowrap text-brand-lightest'>
							{t('app-store.status.update-available')}
						</span>
					)}
					{hasNotes && (
						// A plus built from two strokes: the vertical one rotates flat
						// when the entry opens, so + becomes − in place
						<span aria-hidden className='relative grid h-[15px] w-[15px] shrink-0 place-items-center text-white/40'>
							<span className='absolute h-px w-[9px] rounded-full bg-current' />
							<motion.span
								initial={false}
								animate={{rotate: open ? 90 : 0}}
								transition={expandTransition}
								className='absolute h-[9px] w-px rounded-full bg-current'
							/>
						</span>
					)}
				</span>
				<ReleaseDate date={entry.date} />
			</button>
			{hasNotes ? (
				// Notes stay mounted; the reveal animates height on the sheet's
				// standard morph curve
				<motion.div
					initial={false}
					animate={{height: open ? 'auto' : 0, opacity: open ? 1 : 0}}
					transition={expandTransition}
					className='overflow-hidden'
					inert={!open}
				>
					<div className='flex flex-col gap-2.5 pt-2.5'>
						{/* Key resets the read-more state when the notes change */}
						<ReadMoreMarkdownSection key={entry.notes} className='text-14 text-white/75'>
							{entry.notes}
						</ReadMoreMarkdownSection>
					</div>
				</motion.div>
			) : (
				open && latest && <p className='pt-2 text-13 text-white/30'>{t('app-store.release-timeline.no-notes')}</p>
			)}
		</div>
	)
}

function ReleaseDate({date, className}: {date?: number; className?: string}) {
	const [languageCode] = useLanguage()
	if (date === undefined) return null

	const locale = languageCodeToDateLocale[languageCode]
	return (
		<time
			dateTime={new Date(date).toISOString()}
			title={format(date, 'PP', {locale})}
			className={cn('text-12 whitespace-nowrap text-white/35', className)}
		>
			{formatDistanceToNowStrict(date, {addSuffix: true, locale})}
		</time>
	)
}
