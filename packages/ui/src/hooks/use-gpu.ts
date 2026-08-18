import {useTranslation} from 'react-i18next'
import {sort} from 'remeda'

import {LOADING_DASH} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'

export function useGpu(options: {poll?: boolean} = {}) {
	const gpuQ = trpcReact.system.gpuUsage.useQuery(undefined, {
		retry: false,
		// NVIDIA process telemetry samples over one second. A two-second cadence
		// stays responsive without keeping nvidia-smi running continuously.
		refetchInterval: options.poll ? 2000 : undefined,
	})
	const data = gpuQ.data

	return {
		data,
		isLoading: gpuQ.isLoading,
		hasGpu: (data?.devices.length ?? 0) > 0,
		percentUsed: data?.totalUsed,
		memoryUsed: data?.memoryUsed ?? 0,
		devices: data?.devices ?? [],
		apps: sort(
			[
				...(data?.apps ?? []),
				...(data?.devices.length ? [{id: 'umbreld-system', used: data.system, memoryUsed: data.systemMemoryUsed}] : []),
			],
			(a, b) => b.used - a.used || b.memoryUsed - a.memoryUsed,
		),
	}
}

export function useGpuForUi(options: {poll?: boolean} = {}) {
	const {t, i18n} = useTranslation()
	const {isLoading, hasGpu, percentUsed, memoryUsed, devices, apps} = useGpu(options)

	if (isLoading) {
		return {
			isLoading: true,
			hasGpu: false,
			value: LOADING_DASH,
			secondaryValue: LOADING_DASH,
			progress: 0,
			memoryUsed: 0,
			devices: [],
			apps: [] as Array<{id: string; used: number; memoryUsed: number}>,
		} as const
	}

	return {
		isLoading: false,
		hasGpu,
		value: percentUsed === null || percentUsed === undefined ? LOADING_DASH : `${Math.ceil(percentUsed)}%`,
		secondaryValue: `${maybePrettyBytes(memoryUsed, i18n.language)} ${t('memory').toLocaleLowerCase(i18n.language)}`,
		progress: (percentUsed ?? 0) / 100,
		memoryUsed,
		devices,
		apps,
	} as const
}
