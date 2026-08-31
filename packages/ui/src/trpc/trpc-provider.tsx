import {QueryClientProvider} from '@tanstack/react-query'
import {useState} from 'react'

import {IS_DEV} from '@/utils/misc'

import {LoadingIndicator} from './loading-indicator'
import {queryClient} from './query-client'
import {links, trpcReact} from './trpc'

export const TrpcProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
	const [trpcClient] = useState(() => trpcReact.createClient({links}))

	return (
		<trpcReact.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				{children}
				{IS_DEV && <LoadingIndicator />}
			</QueryClientProvider>
		</trpcReact.Provider>
	)
}
