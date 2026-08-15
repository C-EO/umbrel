import {Navigate, useParams} from 'react-router-dom'

import {Spinner} from '@/components/ui/loading'
import {MachineDisplay} from '@/features/machines/components/machine-display'
import {MACHINES_PATH} from '@/features/machines/constants'
import {useMachine} from '@/features/machines/hooks/use-machines'

// The machine screen content. The surrounding container (the shared card that
// morphs into the VM display) and the control rail live in the layout, so this
// route only renders what's "on screen".
export default function MachineWindow() {
	const {machineId} = useParams<{machineId: string}>()
	const {machine, isLoading} = useMachine(machineId)

	if (isLoading) {
		return (
			<div className='grid h-full w-full place-items-center'>
				<Spinner />
			</div>
		)
	}
	if (!machine) return <Navigate to={MACHINES_PATH} replace />

	return <MachineDisplay machine={machine} />
}
