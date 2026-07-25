import {detectDevice} from '../system/system.js'

// Pro/Home use the forest wallpaper; other devices use the classic default.
export async function getDefaultWallpaper() {
	const device = await detectDevice()
	return device.productName === 'Umbrel Home' || device.productName === 'Umbrel Pro' ? '22' : '18'
}
