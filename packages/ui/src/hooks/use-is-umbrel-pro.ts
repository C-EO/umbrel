import {trpcReact} from '@/trpc/trpc'

export function useIsUmbrelPro({enabled = true}: {enabled?: boolean} = {}) {
	const isUmbrelProQ = trpcReact.hardware.umbrelPro.isUmbrelPro.useQuery(undefined, {enabled})
	const isUmbrelPro = !!isUmbrelProQ.data
	return {
		isUmbrelPro,
		isLoading: isUmbrelProQ.isLoading,
	}
}
