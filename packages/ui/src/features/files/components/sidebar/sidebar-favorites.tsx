import {AnimatePresence, motion} from 'motion/react'
import {useTranslation} from 'react-i18next'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {MachineFolderMetadata} from '@/features/files/hooks/use-machine-folder'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import type {Machine} from '@/features/machines/types'

export function SidebarFavorites({favorites}: {favorites: (string | null)[]}) {
	const {t} = useTranslation()
	const {removeFavorite} = useFavorites()
	const isReadOnly = useIsFilesReadOnly()

	return (
		<AnimatePresence initial={false}>
			{favorites.map((favoritePath: string | null) => {
				if (!favoritePath) return null

				return (
					<motion.div
						key={`sidebar-favorite-${favoritePath}`}
						initial={{opacity: 0, height: 0}}
						animate={{opacity: 1, height: 'auto'}}
						exit={{opacity: 0, height: 0}}
						transition={{duration: 0.2}}
					>
						<ContextMenu>
							<ContextMenuTrigger asChild>
								<div>
									<SidebarFavoriteItem path={favoritePath} />
								</div>
							</ContextMenuTrigger>
							{!isReadOnly ? (
								<ContextMenuContent>
									<ContextMenuItem onClick={() => removeFavorite({path: favoritePath})}>
										{t('files-action.remove-favorite')}
									</ContextMenuItem>
								</ContextMenuContent>
							) : null}
						</ContextMenu>
					</motion.div>
				)
			})}
		</AnimatePresence>
	)
}

function SidebarFavoriteItem({path}: {path: string}) {
	return (
		<MachineFolderMetadata path={path}>
			{({machine}) => <SidebarFavoriteItemContent path={path} machine={machine} />}
		</MachineFolderMetadata>
	)
}

function SidebarFavoriteItemContent({path, machine}: {path: string; machine: Machine | undefined}) {
	const {navigateToDirectory, currentPath} = useNavigate()
	// A machine's directory is named by its id; show the machine's name like the listing does
	const name = machine?.name ?? (path.split('/').pop() || path)

	return (
		<SidebarItem
			item={{name, path, type: 'directory'}}
			machine={machine ?? null}
			isActive={currentPath === path}
			onClick={() => navigateToDirectory(path)}
		/>
	)
}
