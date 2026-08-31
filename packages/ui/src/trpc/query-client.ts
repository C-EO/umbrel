import {QueryClient} from '@tanstack/react-query'

import {MS_PER_MINUTE} from '@/utils/date-time'

// Keep one client so the reconnect handler invalidates the same cache React reads.
export const queryClient = new QueryClient({
	defaultOptions: {queries: {staleTime: MS_PER_MINUTE}},
})
