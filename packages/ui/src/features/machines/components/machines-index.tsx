import {Button} from '@/components/ui/button'
import {Spinner} from '@/components/ui/loading'
import MachinesList from '@/features/machines/components/machines-list'
import OsCatalog from '@/features/machines/components/os-catalog'
import {useMachines} from '@/features/machines/hooks/use-machines'
import {t} from '@/utils/i18n'

// Index page: first-time users see the OS catalog, everyone else sees their VMs
export default function MachinesIndex() {
	const {machines, isLoading, isError, refetch} = useMachines()

	if (isLoading) {
		return (
			<div className='grid min-h-[320px] w-full place-items-center p-12'>
				<Spinner />
			</div>
		)
	}

	// Errors are not emptiness — never fall back to the first-run catalog when
	// the list query failed, or a transient error looks like a factory reset
	if (isError) {
		return (
			<div className='grid min-h-[320px] w-full place-items-center p-12'>
				<div className='flex flex-col items-center gap-4 text-center'>
					<p className='text-15 -tracking-2 text-white/60'>{t('machines.list-error')}</p>
					<Button onClick={() => refetch()}>{t('try-again')}</Button>
				</div>
			</div>
		)
	}

	if (machines.length === 0) return <OsCatalog />

	return <MachinesList machines={machines} />
}
