import {AnimatePresence} from 'motion/react'
import {useTranslation} from 'react-i18next'
import {TbKey} from 'react-icons/tb'

import {AnimatedRow, RowRemoveButton, shareListClass} from '@/modules/user-sharing'
import {BackButton} from '@/routes/settings/_components/shared'
import {type RouterOutput} from '@/trpc/trpc'

type McpToken = RouterOutput['mcp']['listTokens'][number]

// ─── Authorized tokens drill-in ─────────────────────────────────────
// Every "Connect a new agent" run mints its own token, and this is where
// they're accounted for: one masked row per live token, each with the
// revoke that cuts its agent off. Mirrors the app/folder drill-ins so the
// whole dialog reads as one surface.

export function TokensDetail({
	tokens,
	busy,
	onRevoke,
	onBack,
}: {
	tokens: McpToken[]
	busy: boolean
	onRevoke: (id: string) => void
	onBack: () => void
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('mcp')}</BackButton>

			<section className='flex flex-col gap-2'>
				<div className='text-15 font-semibold -tracking-2'>{t('mcp-tokens')}</div>
				<p className='text-12 leading-tight text-white/35'>{t('mcp-tokens-detail-description')}</p>
				<div className={shareListClass(tokens.length)}>
					<AnimatePresence initial={false}>
						{tokens.map((token) => (
							<AnimatedRow key={token.id}>
								<div className='flex items-center gap-3 p-3'>
									<span className='grid size-8 shrink-0 place-items-center rounded-full bg-white/8'>
										<TbKey className='size-4 text-white/50' />
									</span>
									<span className='min-w-0 flex-1'>
										<span className='block truncate text-13 font-medium -tracking-2 text-white/90'>{token.label}</span>
										<span className='block truncate font-mono text-11 text-white/35'>
											umbrelmcp_{token.id.slice(0, 8)}_••••••••
										</span>
									</span>
									<RowRemoveButton label={t('mcp-tokens-revoke')} disabled={busy} onClick={() => onRevoke(token.id)} />
								</div>
							</AnimatedRow>
						))}
					</AnimatePresence>
				</div>
			</section>
		</div>
	)
}
