import {BrowserRouter} from 'react-router-dom'

import {init} from './init'
import LoginWithUmbrel from './routes/app-auth'

init(
	// NOTE: not putting `GlobalSystemStateProvider` here because we don't care.
	// It doesn't matter for the auth page
	<BrowserRouter>
		<LoginWithUmbrel />
	</BrowserRouter>,
)
