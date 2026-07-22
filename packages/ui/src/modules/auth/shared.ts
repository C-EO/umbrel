import {trpcClient} from '@/trpc/trpc'
import {MS_PER_HOUR} from '@/utils/date-time'

import {startTokenRenewal} from './token-renewal'

export {AUTH_TOKEN_LOCAL_STORAGE_KEY} from './token-renewal'

export function initTokenRenewal() {
	startTokenRenewal({
		storage: localStorage,
		interval: MS_PER_HOUR,
		renewToken: () => trpcClient.user.renewToken.mutate(),
	})
}
