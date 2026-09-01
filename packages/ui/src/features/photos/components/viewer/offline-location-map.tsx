import {MapPin} from 'lucide-react'
import {useEffect, useId, useMemo, useState} from 'react'

import {cn} from '@/lib/utils'
import {formatNumberI18n} from '@/utils/number'

export const OFFLINE_MAP_DATA_URL = '/assets/photos/offline-map-v1.json'

const WIDTH = 320
const HEIGHT = 144
const LATITUDE_SPAN = 5.5

type Point = [lng: number, lat: number]
type Bounds = [west: number, south: number, east: number, north: number]
type Country = [name: string, iso2: string, bounds: Bounds, rings: Point[][]]
type MapLine = [bounds: Bounds, points: Point[]]
type Place = [lng: number, lat: number, name: string, region: string, iso2: string, population: number, rank: number]

export type OfflineMapData = {
	version: 1
	source: string
	c: Country[]
	s: MapLine[]
	r: MapLine[]
	p: Place[]
}

type Projection = {
	center: Point
	lngSpan: number
	latSpan: number
	point: (position: Point) => [x: number, y: number]
}

type Label = {name: string; x: number; y: number}

type MapModel = {
	countries: string
	regions: string
	roads: string
	labels: Label[]
	place: string
}

let atlasPromise: Promise<OfflineMapData> | undefined

// The only runtime resource behind this map is a same-origin static asset. No
// style document, tile, sprite, glyph, geocoder, or telemetry URL is involved.
export function fetchOfflineMapData(fetcher: typeof fetch = fetch) {
	return fetcher(OFFLINE_MAP_DATA_URL, {credentials: 'same-origin'}).then((response) => {
		if (!response.ok) throw new Error(`Unable to load offline map data (${response.status})`)
		return response.json() as Promise<OfflineMapData>
	})
}

// Exported so the lightbox's neighbour prefetch can warm the atlas (and,
// through the dynamic import that reaches this, the chunk) before a step
// lands on a located item with the inspector open
export function loadAtlas() {
	if (!atlasPromise) {
		atlasPromise = fetchOfflineMapData()
		// A transient failure must not poison the session's cache: the next
		// panel that asks retries the fetch
		atlasPromise.catch(() => (atlasPromise = undefined))
	}
	return atlasPromise
}

export function OfflineLocationMap({
	lat,
	lng,
	altitude,
	locale,
}: {
	lat: number
	lng: number
	altitude?: number
	locale: string
}) {
	const [atlas, setAtlas] = useState<OfflineMapData>()
	const [unavailable, setUnavailable] = useState(false)
	const id = useId().replaceAll(':', '')
	const waterId = `photos-map-water-${id}`
	const gridId = `photos-map-grid-${id}`

	useEffect(() => {
		let current = true
		loadAtlas().then(
			(data) => current && setAtlas(data),
			() => current && setUnavailable(true),
		)
		return () => {
			current = false
		}
	}, [])

	const model = useMemo(() => (atlas ? buildMapModel(atlas, lat, lng, locale) : undefined), [atlas, lat, lng, locale])
	const coordinates = coordinateDescription(lat, lng)
	const details = `${coordinates}${
		altitude === undefined ? '' : ` · ${formatNumberI18n({n: altitude, showDecimals: true, locale})} m`
	}`
	const description = [model?.place, details].filter(Boolean).join('. ')

	return (
		<div
			role='img'
			aria-label={description}
			className='relative h-36 w-full overflow-hidden rounded-xl bg-[#17222a] ring-1 ring-white/8'
		>
			<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className='absolute inset-0 size-full' aria-hidden='true'>
				<defs>
					<linearGradient id={waterId} x1='0' y1='0' x2='1' y2='1'>
						<stop stopColor='#1e303b' />
						<stop offset='1' stopColor='#17242d' />
					</linearGradient>
					<pattern id={gridId} width='32' height='32' patternUnits='userSpaceOnUse'>
						<path d='M 32 0 L 0 0 0 32' fill='none' stroke='rgba(255,255,255,.035)' strokeWidth='.65' />
					</pattern>
				</defs>
				<rect width={WIDTH} height={HEIGHT} fill={`url(#${waterId})`} />
				<rect width={WIDTH} height={HEIGHT} fill={`url(#${gridId})`} />
				{model && (
					<>
						<path
							d={model.countries}
							fill='#344139'
							fillRule='evenodd'
							stroke='rgba(211,226,210,.22)'
							strokeWidth='.65'
							strokeLinejoin='round'
						/>
						<path
							d={model.regions}
							fill='none'
							stroke='rgba(226,235,222,.13)'
							strokeWidth='.55'
							strokeDasharray='1.5 1.5'
						/>
						<path d={model.roads} fill='none' stroke='rgba(241,205,140,.24)' strokeWidth='.72' strokeLinecap='round' />
						{model.labels.map(({name, x, y}) => (
							<g key={`${name}-${x}-${y}`}>
								<circle cx={x} cy={y} r='1.15' fill='rgba(255,255,255,.62)' />
								<text
									x={x}
									y={y - 3.5}
									textAnchor='middle'
									fontSize='6.7'
									fontWeight='500'
									fill='rgba(255,255,255,.55)'
									stroke='rgba(18,29,35,.9)'
									strokeWidth='1.8'
									paintOrder='stroke'
								>
									{name}
								</text>
							</g>
						))}
					</>
				)}
			</svg>

			<div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full drop-shadow-[0_2px_5px_rgba(0,0,0,.65)]'>
				<MapPin className='size-7 fill-[#ff5252] text-white' strokeWidth={1.65} />
			</div>

			<div className='pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pt-8 pb-2.5'>
				<p
					className={cn(
						'truncate text-12 font-medium text-white/90',
						!model && !unavailable && 'h-4 w-36 animate-pulse rounded bg-white/10',
					)}
				>
					{model?.place}
				</p>
				<p className='mt-0.5 truncate text-11 font-medium text-white/55 tabular-nums'>{details}</p>
			</div>
			<p className='absolute top-2 right-2 text-[8px] font-medium tracking-wide text-white/28 uppercase'>
				{model ? 'Natural Earth' : ''}
			</p>
		</div>
	)
}

export function createProjection(lat: number, lng: number): Projection {
	const center: Point = [normalizeLongitude(lng), clamp(lat, -85, 85)]
	const latitudeScale = Math.max(0.25, Math.cos((center[1] * Math.PI) / 180))
	const lngSpan = Math.min(42, (LATITUDE_SPAN * WIDTH) / HEIGHT / latitudeScale)
	return {
		center,
		lngSpan,
		latSpan: LATITUDE_SPAN,
		point: ([pointLng, pointLat]) => [
			WIDTH / 2 + (longitudeDelta(pointLng, center[0]) / lngSpan) * WIDTH,
			HEIGHT / 2 - ((pointLat - center[1]) / LATITUDE_SPAN) * HEIGHT,
		],
	}
}

export function buildMapModel(atlas: OfflineMapData, lat: number, lng: number, locale: string): MapModel {
	const projection = createProjection(lat, lng)
	const visible = (bounds: Bounds) => boundsVisible(bounds, projection)
	const countryRecords = atlas.c.filter(([, , bounds]) => visible(bounds))
	const countries = countryRecords.map(([, , , rings]) => polygonPath(rings, projection)).join(' ')
	const regions = atlas.s
		.filter(([bounds]) => visible(bounds))
		.map(([, points]) => linePath(points, projection))
		.join(' ')
	const roads = atlas.r
		.filter(([bounds]) => visible(bounds))
		.map(([, points]) => linePath(points, projection))
		.join(' ')
	const nearbyPlaces = atlas.p.filter(([placeLng, placeLat]) => {
		const [x, y] = projection.point([placeLng, placeLat])
		return x >= -16 && x <= WIDTH + 16 && y >= 8 && y <= HEIGHT - 24
	})
	const labels = placeLabels(nearbyPlaces, projection)
	const place = locationName(atlas, lat, lng, locale)

	return {countries, regions, roads, labels, place}
}

export function locationName(atlas: OfflineMapData, lat: number, lng: number, locale: string) {
	let nearest: {place: Place; distance: number} | undefined
	for (const place of atlas.p) {
		const distance = haversineKm(lat, lng, place[1], place[0])
		if (!nearest || distance < nearest.distance) nearest = {place, distance}
	}

	const country = atlas.c.find(([, , bounds, rings]) => pointInPolygon([lng, lat], bounds, rings))
	const countryCode =
		country?.[1] || (nearest?.distance !== undefined && nearest.distance <= 250 ? nearest.place[4] : '')
	const countryName = countryDisplayName(countryCode, locale) || country?.[0] || ''
	const parts: string[] = []
	if (nearest && nearest.distance <= 180) {
		parts.push(nearest.place[2])
		if (nearest.place[3] && nearest.place[3] !== nearest.place[2]) parts.push(nearest.place[3])
	}
	if (countryName && !parts.includes(countryName)) parts.push(countryName)
	return parts.join(', ')
}

function placeLabels(places: Place[], projection: Projection): Label[] {
	const boxes: Array<{left: number; top: number; right: number; bottom: number}> = []
	const labels: Label[] = []
	const candidates = [...places].filter((place) => place[6] <= 7).sort((a, b) => a[6] - b[6] || b[5] - a[5])

	for (const place of candidates) {
		if (labels.length >= 6) break
		const [x, y] = projection.point([place[0], place[1]])
		if (Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) < 25) continue
		const halfWidth = Math.min(34, Math.max(10, place[2].length * 2.15))
		const box = {left: x - halfWidth, top: y - 11, right: x + halfWidth, bottom: y + 3}
		if (boxes.some((other) => overlaps(box, other))) continue
		boxes.push(box)
		labels.push({name: place[2], x, y})
	}
	return labels
}

function polygonPath(rings: Point[][], projection: Projection) {
	return rings.map((ring) => `${linePath(ring, projection)} Z`).join(' ')
}

function linePath(points: Point[], projection: Projection) {
	if (points.length === 0) return ''
	const unwrapped = unwrap(points, projection.center[0])
	return unwrapped
		.map(([lng, lat], index) => {
			const x = WIDTH / 2 + ((lng - projection.center[0]) / projection.lngSpan) * WIDTH
			const y = HEIGHT / 2 - ((lat - projection.center[1]) / projection.latSpan) * HEIGHT
			return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
		})
		.join(' ')
}

function unwrap(points: Point[], centerLng: number) {
	let previous = centerLng + longitudeDelta(points[0]![0], centerLng)
	return points.map(([lng, lat], index): Point => {
		if (index === 0) return [previous, lat]
		let unwrapped = centerLng + longitudeDelta(lng, centerLng)
		while (unwrapped - previous > 180) unwrapped -= 360
		while (unwrapped - previous < -180) unwrapped += 360
		previous = unwrapped
		return [unwrapped, lat]
	})
}

function boundsVisible([west, south, east, north]: Bounds, projection: Projection) {
	const latitudeVisible =
		north >= projection.center[1] - projection.latSpan / 2 && south <= projection.center[1] + projection.latSpan / 2
	if (!latitudeVisible) return false
	const width = east - west
	if (width >= 180) return true
	const center = west + width / 2
	return Math.abs(longitudeDelta(center, projection.center[0])) <= projection.lngSpan / 2 + width / 2
}

function pointInPolygon([lng, lat]: Point, [, south, , north]: Bounds, rings: Point[][]) {
	if (lat < south || lat > north) return false
	const inRing = (ring: Point[]) => {
		let inside = false
		for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
			const [currentLng, currentLat] = ring[current]!
			const [previousLng, previousLat] = ring[previous]!
			const x1 = longitudeDelta(currentLng, lng)
			const x2 = longitudeDelta(previousLng, lng)
			if (
				currentLat > lat !== previousLat > lat &&
				0 < ((x2 - x1) * (lat - currentLat)) / (previousLat - currentLat) + x1
			)
				inside = !inside
		}
		return inside
	}
	return Boolean(rings[0] && inRing(rings[0]) && !rings.slice(1).some(inRing))
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
	const radians = Math.PI / 180
	const dLat = (lat2 - lat1) * radians
	const dLng = longitudeDelta(lng2, lng1) * radians
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2
	return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function countryDisplayName(code: string, locale: string) {
	if (!code) return ''
	try {
		return new Intl.DisplayNames([locale], {type: 'region'}).of(code) || ''
	} catch {
		return new Intl.DisplayNames(['en'], {type: 'region'}).of(code) || ''
	}
}

function coordinateDescription(lat: number, lng: number) {
	const latitude = `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`
	const longitude = `${Math.abs(lng).toFixed(4)}° ${lng < 0 ? 'W' : 'E'}`
	return `${latitude}, ${longitude}`
}

function overlaps(a: {left: number; top: number; right: number; bottom: number}, b: typeof a) {
	return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function longitudeDelta(lng: number, center: number) {
	return ((((lng - center + 180) % 360) + 360) % 360) - 180
}

function normalizeLongitude(lng: number) {
	return longitudeDelta(lng, 0)
}

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value))
}
