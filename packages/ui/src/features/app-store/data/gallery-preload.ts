import type {RegistryApp} from '@/trpc/trpc'
import {preloadImage} from '@/utils/misc'

const alreadyPreloaded = new Set<string>()

/**
 * Warms the first few gallery screenshots on hover intent so the app page
 * feels instant, without eagerly downloading galleries for every card.
 */
export function preloadFirstFewGalleryImages(app: RegistryApp) {
	if (alreadyPreloaded.has(app.id)) return
	alreadyPreloaded.add(app.id)
	app.gallery.slice(0, 3).map(preloadImage)
}
