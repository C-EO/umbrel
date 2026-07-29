// Served from public/ because the CSP blocks data: URIs, so it must never be
// inlined by the bundler. Accepts style because the Icon wrapper sizes icons
// through inline width/height.
export function CloudIcon({className, style}: {className?: string; style?: React.CSSProperties}) {
	return <img src='/assets/cloud/cloud.webp' alt='' className={className} style={style} draggable={false} />
}
