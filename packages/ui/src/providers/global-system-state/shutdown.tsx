import {useTranslation} from 'react-i18next'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {trpcReact, type RouterError} from '@/trpc/trpc'

export function useShutdown({
	onMutate,
	onSuccess,
	onError,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
	onError?: (error: RouterError) => void
}) {
	const shutdownMut = trpcReact.system.shutdown.useMutation({
		// A shutdown must fail now rather than queue and run when connectivity returns.
		networkMode: 'always',
		retry: false,
		onMutate,
		onSuccess,
		onError,
	})
	const shutdown = shutdownMut.mutate

	return shutdown
}

export function ShuttingDownCover() {
	const {t} = useTranslation()
	return (
		<CoverMessage>
			<Loading>{t('shut-down.shutting-down')}</Loading>
			<CoverMessageParagraph>{t('shut-down.shutting-down-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
