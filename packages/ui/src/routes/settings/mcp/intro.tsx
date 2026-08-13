import {Info} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {InfoAlert} from '@/components/ui/alert'
import {BetaPill} from '@/components/ui/beta-pill'
import {Button} from '@/components/ui/button'
import type {McpAgentId} from '@/routes/settings/mcp/agents'
import {AgentConstellation} from '@/routes/settings/mcp/constellation'
import {PitchReplay} from '@/routes/settings/mcp/pitch-replay'

// The first-run pitch: agents orbiting the umbrel, the promise shown as a
// replayed chat, one confident CTA. The CTA morphs the constellation into the
// agent picker — choosing a tile is what actually enables MCP, so the choice
// lands the user in a connect view already tailored to their agent. When MCP
// already has saved credentials, the same surface offers a direct resume.

export function IntroView({
	onSelect,
	onResume,
	connecting,
	defaultView = 'pitch',
}: {
	onSelect?: (agent: McpAgentId | 'generic') => void
	onResume?: () => void
	connecting: boolean
	// A remount after a failed enable attempt returns to the picker, not the pitch
	defaultView?: 'pitch' | 'picker'
}) {
	const {t} = useTranslation()
	const reducedMotion = useReducedMotion() ?? false
	const [view, setView] = useState<'pitch' | 'picker'>(defaultView)
	const isPitch = view === 'pitch'

	return (
		<div className='flex flex-col gap-5'>
			{/* The pitch headline flips into the picker's question so the grid
			    doesn't open cold */}
			<AnimatePresence>
				{!isPitch && (
					<motion.div
						key='picker-heading'
						initial={reducedMotion ? false : {opacity: 0, y: 4}}
						animate={{opacity: 1, y: 0}}
						transition={{duration: 0.3, delay: 0.15}}
						className='space-y-1 text-center'
					>
						<div className='flex justify-center pb-1'>
							<BetaPill />
						</div>
						<h3 className='text-19 font-semibold -tracking-2'>{t('mcp-picker-title')}</h3>
						<p className='text-13 leading-tight text-white/40'>{t('mcp-picker-description')}</p>
					</motion.div>
				)}
			</AnimatePresence>

			<AgentConstellation view={view} busy={connecting} onSelect={onSelect} />

			{/* The honest fine print sits with the commitment, not the pitch: it
			    appears under the tiles at the moment an agent is actually chosen */}
			<AnimatePresence>
				{!isPitch && (
					<motion.div
						key='picker-note'
						initial={reducedMotion ? false : {opacity: 0, y: 4}}
						animate={{opacity: 1, y: 0}}
						transition={{duration: 0.3, delay: 0.25}}
						exit={{opacity: 0, transition: {duration: 0.15}}}
					>
						<InfoAlert icon={Info} description={t('mcp-intro-beta-note')} className='text-left' />
					</motion.div>
				)}
			</AnimatePresence>

			{/* The pitch's promise and its single CTA make way once the picker
			    unfolds. On mount the copy arrives in soft beats: the heading lands
			    alongside the agents, then the replay stage eases in and starts
			    playing, then the invitation. */}
			<AnimatePresence>
				{isPitch && (
					<motion.div
						key='pitch-copy'
						initial={false}
						exit={{opacity: 0, transition: {duration: 0.15}}}
						className='flex flex-col items-center gap-5 pb-2 text-center'
					>
						<motion.div
							initial={reducedMotion ? false : {opacity: 0, y: 6}}
							animate={{opacity: 1, y: 0}}
							transition={{duration: 0.35, delay: 0.35}}
							className='flex flex-col items-center gap-2'
						>
							<BetaPill />
							<p className='text-19 font-semibold -tracking-2'>{t('mcp-intro-title')}</p>
						</motion.div>
						<motion.div
							initial={reducedMotion ? false : {opacity: 0, y: 4}}
							animate={{opacity: 1, y: 0}}
							transition={{duration: 0.4, delay: 0.55}}
							className='w-full'
						>
							<PitchReplay />
						</motion.div>
						<motion.div
							initial={reducedMotion ? false : {opacity: 0, y: 4}}
							animate={{opacity: 1, y: 0}}
							transition={{duration: 0.4, delay: 0.85}}
						>
							<Button variant='primary' size='dialog' onClick={onResume ?? (() => setView('picker'))}>
								{t(onResume ? 'mcp-enable' : 'mcp-intro-cta')}
							</Button>
							{onResume && (
								<p className='mt-2 max-w-80 text-12 leading-tight text-white/35'>{t('mcp-enable-description')}</p>
							)}
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
