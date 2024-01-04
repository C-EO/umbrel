import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import FailedLayout from '@/modules/bare/failed-layout'

export default function MigrateFailed() {
	const title = 'Migration failed'
	useUmbrelTitle(title)

	return (
		<FailedLayout
			title={title}
			description={
				<>
					There was an error during migration.
					<br />
					Please try again.
				</>
			}
			buttonText='Retry migration'
			to='/migrate'
		/>
	)
}
