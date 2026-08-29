export const wallpapers = [
	{id: '1', brandColorHsl: '259 100% 59%'},
	{id: '2', brandColorHsl: '6 56% 54%'},
	{id: '3', brandColorHsl: '22 88% 40%'},
	{id: '4', brandColorHsl: '198 100% 31%'},
	{id: '5', brandColorHsl: '202 100% 33%'},
	{id: '6', brandColorHsl: '160 100% 27%'},
	{id: '7', brandColorHsl: '79 100% 25%'},
	{id: '8', brandColorHsl: '185 100% 29%'},
	{id: '9', brandColorHsl: '359 64% 62%'},
	{id: '10', brandColorHsl: '18 75% 52%'},
	{id: '11', brandColorHsl: '185 100% 29%'},
	{id: '12', brandColorHsl: '332 84% 47%'},
	{id: '13', brandColorHsl: '194 81% 39%'},
	{id: '14', brandColorHsl: '328 87% 49%'},
	{id: '15', brandColorHsl: '32 100% 36%'},
	{id: '16', brandColorHsl: '265 100% 42%'},
	{id: '17', brandColorHsl: '184 100% 25%'},
	{id: '18', brandColorHsl: '259 100% 59%'},
	{id: '19', brandColorHsl: '204 100% 41%'},
	{id: '20', brandColorHsl: '259 100% 59%'},
	{id: '21', brandColorHsl: '12 78% 50%'},
	{id: '22', brandColorHsl: '92 52% 41%'},
	{id: '23', brandColorHsl: '24 90% 50%'},
	{id: '24', brandColorHsl: '209 85% 42%'},
	{id: '25', brandColorHsl: '174 75% 32%'},
	{id: '26', brandColorHsl: '14 96% 52%'},
] as const

export type Wallpaper = (typeof wallpapers)[number]
export type WallpaperId = Wallpaper['id']
export type WallpaperAppearance = Pick<Wallpaper, 'id' | 'brandColorHsl'>

export const defaultWallpaperId: WallpaperId = '23'

export const wallpapersKeyed = Object.fromEntries(wallpapers.map((wallpaper) => [wallpaper.id, wallpaper])) as Record<
	WallpaperId,
	Wallpaper
>

export const wallpaperIds = wallpapers.map((wallpaper) => wallpaper.id)

export function isWallpaperId(id: string): id is WallpaperId {
	return Object.hasOwn(wallpapersKeyed, id)
}

export function resolveWallpaper(id?: string): Wallpaper {
	if (!id || !isWallpaperId(id)) return wallpapersKeyed[defaultWallpaperId]
	return wallpapersKeyed[id]
}

export function resolveWallpaperAppearance(id?: string): WallpaperAppearance {
	const {id: resolvedId, brandColorHsl} = resolveWallpaper(id)
	return {id: resolvedId, brandColorHsl}
}
