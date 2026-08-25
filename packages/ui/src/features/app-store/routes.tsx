import React from 'react'
import {RouteObject} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'

const AppStoreLayout = React.lazy(() => import('@/features/app-store'))
const Discover = React.lazy(() => import('@/features/app-store/components/discover'))
const Category = React.lazy(() => import('@/features/app-store/components/category'))
const AppPage = React.lazy(() => import('@/features/app-store/components/app-page'))

// Mounted inside SheetLayout. The app page is a sibling of the store shell so
// it renders without the store header/search chrome, like a pushed detail view.
export const appStoreRoutes: RouteObject[] = [
	{
		path: 'app-store',
		element: <AppStoreLayout />,
		ErrorBoundary: ErrorBoundaryCardFallback,
		children: [
			{
				index: true,
				element: <Discover />,
				ErrorBoundary: ErrorBoundaryCardFallback,
			},
			{
				path: 'category/:categoryId',
				element: <Category />,
				ErrorBoundary: ErrorBoundaryCardFallback,
			},
		],
	},
	{
		path: 'app-store/:appId',
		element: <AppPage />,
		ErrorBoundary: ErrorBoundaryCardFallback,
	},
]
