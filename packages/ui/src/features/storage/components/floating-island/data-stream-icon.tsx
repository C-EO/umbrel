// Animated icons for RAID progress in floating island.
//
// DataStreamIcon: drive-shaped icon for the expanded view - an M.2 SSD with flickering
// NAND cells, or a 3.5" hard drive with a spinning platter for HDD pools.
// DataStreamIconMini: circular activity icon for the minimized view - a flickering cell
// grid, or a spinning platter for HDD pools.
//
// Both take a `variant` matching getPoolDeviceType()'s classification of the active pool.

import {useEffect, useState} from 'react'

export type DriveVariant = 'ssd' | 'hdd'

interface DataStreamIconProps {
	size?: number
	isActive?: boolean
	variant?: DriveVariant
}

export function DataStreamIcon({variant = 'ssd', ...props}: DataStreamIconProps) {
	return variant === 'hdd' ? <HddDataStreamIcon {...props} /> : <SsdDataStreamIcon {...props} />
}

export function DataStreamIconMini({variant = 'ssd', ...props}: DataStreamIconProps) {
	return variant === 'hdd' ? <HddDataStreamIconMini {...props} /> : <SsdDataStreamIconMini {...props} />
}

// --- SSD (expanded) ---
// SSD-shaped icon with flickering squares and M.2 connector bars.

function SsdDataStreamIcon({size = 32, isActive = true}: Omit<DataStreamIconProps, 'variant'>) {
	const [activeCells, setActiveCells] = useState<Set<number>>(new Set())

	const gridCols = 5
	const gridRows = 10

	useEffect(() => {
		if (!isActive) {
			setActiveCells(new Set())
			return
		}

		const updateInterval = 90
		const minActive = 2
		const maxActive = 6
		const persistChance = 0.5

		const interval = setInterval(() => {
			setActiveCells((prev) => {
				const next = new Set<number>()
				const numActive = Math.floor(Math.random() * (maxActive - minActive + 1)) + minActive

				for (let i = 0; i < numActive; i++) {
					const cellIndex = Math.floor(Math.random() * gridCols * gridRows)
					next.add(cellIndex)
				}

				prev.forEach((cell) => {
					if (Math.random() > persistChance) {
						next.add(cell)
					}
				})

				return next
			})
		}, updateInterval)

		return () => clearInterval(interval)
	}, [isActive])

	const width = size
	const height = size * 2.5
	const borderRadius = 3
	const teethHeight = 4

	const gridPadding = 4
	const gridTop = teethHeight + 8
	const gridHeight = height - gridTop - gridPadding
	const gridWidth = width - gridPadding * 2
	const cellWidth = gridWidth / gridCols
	const cellHeight = gridHeight / gridRows
	const gapSize = 1

	const cells = []
	for (let row = 0; row < gridRows; row++) {
		for (let col = 0; col < gridCols; col++) {
			const index = row * gridCols + col
			const isActiveCell = activeCells.has(index)

			const x = gridPadding + col * cellWidth + gapSize / 2
			const y = gridTop + row * cellHeight + gapSize / 2
			const actualWidth = cellWidth - gapSize
			const actualHeight = cellHeight - gapSize

			cells.push(
				<div
					key={index}
					className='absolute bg-brand transition-all duration-75'
					style={{
						left: x,
						top: y,
						width: actualWidth,
						height: actualHeight,
						borderRadius: 1,
						opacity: isActiveCell ? 1 : 0.3,
						boxShadow: isActiveCell ? '0 0 4px hsl(var(--color-brand)), 0 0 6px hsl(var(--color-brand) / 0.5)' : 'none',
					}}
				/>,
			)
		}
	}

	// Connector bar styling - M.2 diagram style
	const connectorColor = 'rgba(255, 255, 255, 0.15)'
	const connectorHeight = 2
	const connectorTop = teethHeight
	const notchGap = 2
	const notchPosition = width * 0.7
	const leftBarWidth = notchPosition - 2
	const rightBarWidth = width - notchPosition - notchGap - 2

	return (
		<div className='relative' style={{width, height}}>
			{/* SSD body */}
			<div
				className='absolute bg-white/10'
				style={{
					top: teethHeight + connectorHeight,
					left: 0,
					right: 0,
					bottom: 0,
					borderRadius,
				}}
			/>

			{/* Connector bar - left section */}
			<div
				className='absolute'
				style={{
					left: 2,
					top: connectorTop,
					width: leftBarWidth,
					height: connectorHeight,
					backgroundColor: connectorColor,
					borderRadius: '1px 1px 0 0',
				}}
			/>

			{/* Connector bar - right section */}
			<div
				className='absolute'
				style={{
					left: notchPosition + notchGap,
					top: connectorTop,
					width: rightBarWidth,
					height: connectorHeight,
					backgroundColor: connectorColor,
					borderRadius: '1px 1px 0 0',
				}}
			/>

			{/* Flickering grid cells */}
			{cells}
		</div>
	)
}

// --- HDD (expanded) ---
// 3.5" drive seen from above: grooved platter with a spinning data sheen, a seeking
// actuator arm, and a flickering activity LED. Drawn in the same brand-glow material
// language as the SSD variant.

function HddDataStreamIcon({size = 32, isActive = true}: Omit<DataStreamIconProps, 'variant'>) {
	const [armAngle, setArmAngle] = useState(-30)
	const [ledOn, setLedOn] = useState(false)

	useEffect(() => {
		if (!isActive) {
			setLedOn(false)
			return
		}

		// One interval drives both the seek jitter and the LED flicker
		const interval = setInterval(() => {
			setArmAngle(-18 - Math.random() * 26)
			setLedOn(Math.random() > 0.45)
		}, 260)

		return () => clearInterval(interval)
	}, [isActive])

	const width = size * 1.9
	const height = size * 2.4
	const platterSize = width - 8
	const platterTop = 5
	const armLength = platterSize * 0.62

	return (
		<div className='relative' style={{width, height}}>
			{/* Drive body */}
			<div className='absolute inset-0 bg-white/10' style={{borderRadius: 4}} />

			{/* Platter with grooves and spinning data sheen */}
			<div
				className='absolute overflow-hidden rounded-full'
				style={{
					left: (width - platterSize) / 2,
					top: platterTop,
					width: platterSize,
					height: platterSize,
					background:
						'repeating-radial-gradient(circle at center, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.10) 4px)',
				}}
			>
				<div
					className='absolute inset-0 animate-spin'
					style={{
						background:
							'conic-gradient(from 0deg, transparent 0deg, hsl(var(--color-brand) / 0.6) 60deg, transparent 130deg)',
						animationDuration: '1.1s',
						animationPlayState: isActive ? 'running' : 'paused',
						opacity: isActive ? 1 : 0.25,
						transition: 'opacity 300ms',
					}}
				/>
			</div>

			{/* Spindle */}
			<div
				className='absolute rounded-full bg-white/50'
				style={{left: width / 2 - 2, top: platterTop + platterSize / 2 - 2, width: 4, height: 4}}
			/>

			{/* Actuator arm with read head, pivoting from the bottom-right corner */}
			<div
				className='absolute rounded-full bg-white/45 transition-transform duration-200'
				style={{
					width: 2.5,
					height: armLength,
					left: width - 8,
					bottom: 5,
					transformOrigin: '50% 100%',
					transform: `rotate(${armAngle}deg)`,
				}}
			>
				<div
					className='absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-brand'
					style={{boxShadow: '0 0 4px hsl(var(--color-brand))'}}
				/>
			</div>
			<div className='absolute rounded-full bg-white/30' style={{width: 4, height: 4, left: width - 8.75, bottom: 4}} />

			{/* Activity LED */}
			<div
				className='absolute rounded-full transition-all duration-75'
				style={{
					width: 3,
					height: 3,
					left: 5,
					bottom: 4,
					backgroundColor: ledOn ? 'hsl(var(--color-brand))' : 'hsl(var(--color-brand) / 0.25)',
					boxShadow: ledOn ? '0 0 4px hsl(var(--color-brand)), 0 0 6px hsl(var(--color-brand) / 0.5)' : 'none',
				}}
			/>
		</div>
	)
}

// --- SSD (minimized) ---
// Circular grid of flickering squares for minimized island view.

function SsdDataStreamIconMini({size = 20, isActive = true}: Omit<DataStreamIconProps, 'variant'>) {
	const [activeCells, setActiveCells] = useState<Set<number>>(new Set())

	const gridSize = 5
	const cellSize = size / gridSize
	const gapSize = 1

	useEffect(() => {
		if (!isActive) {
			setActiveCells(new Set())
			return
		}

		const interval = setInterval(() => {
			setActiveCells((prev) => {
				const next = new Set<number>()
				const numActive = Math.floor(Math.random() * 4) + 2 // 2-5 cells

				for (let i = 0; i < numActive; i++) {
					const cellIndex = Math.floor(Math.random() * gridSize * gridSize)
					next.add(cellIndex)
				}

				prev.forEach((cell) => {
					if (Math.random() > 0.5) {
						next.add(cell)
					}
				})

				return next
			})
		}, 60)

		return () => clearInterval(interval)
	}, [isActive])

	const cells = []
	for (let row = 0; row < gridSize; row++) {
		for (let col = 0; col < gridSize; col++) {
			const index = row * gridSize + col
			const isActiveCell = activeCells.has(index)

			const x = col * cellSize + gapSize / 2
			const y = row * cellSize + gapSize / 2
			const actualSize = cellSize - gapSize

			// Circular mask - fade out cells near edges
			const centerX = gridSize / 2 - 0.5
			const centerY = gridSize / 2 - 0.5
			const distFromCenter = Math.sqrt(Math.pow(col - centerX, 2) + Math.pow(row - centerY, 2))
			const maxDist = gridSize / 2
			const opacity = Math.max(0, 1 - distFromCenter / maxDist)

			if (opacity < 0.2) continue

			cells.push(
				<div
					key={index}
					className='absolute bg-brand transition-all duration-75'
					style={{
						left: x,
						top: y,
						width: actualSize,
						height: actualSize,
						borderRadius: 1,
						opacity: isActiveCell ? opacity : opacity * 0.3,
						boxShadow: isActiveCell ? '0 0 6px hsl(var(--color-brand)), 0 0 8px hsl(var(--color-brand) / 0.5)' : 'none',
					}}
				/>,
			)
		}
	}

	return (
		<div className='relative' style={{width: size, height: size}}>
			{isActive && (
				<div
					className='absolute inset-0 rounded-full'
					style={{
						background: 'radial-gradient(circle, hsl(var(--color-brand) / 0.2) 0%, transparent 70%)',
					}}
				/>
			)}
			<div className='absolute inset-0'>{cells}</div>
		</div>
	)
}

// --- HDD (minimized) ---
// Spinning grooved platter for minimized island view.

function HddDataStreamIconMini({size = 20, isActive = true}: Omit<DataStreamIconProps, 'variant'>) {
	return (
		<div className='relative' style={{width: size, height: size}}>
			{isActive && (
				<div
					className='absolute inset-0 rounded-full'
					style={{
						background: 'radial-gradient(circle, hsl(var(--color-brand) / 0.2) 0%, transparent 70%)',
					}}
				/>
			)}
			<div
				className='absolute overflow-hidden rounded-full'
				style={{
					inset: 1,
					border: '1px solid rgba(255,255,255,0.25)',
					background:
						'repeating-radial-gradient(circle at center, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.05) 1.5px, rgba(255,255,255,0.12) 3px)',
				}}
			>
				<div
					className='absolute inset-0 animate-spin'
					style={{
						background:
							'conic-gradient(from 0deg, transparent 0deg, hsl(var(--color-brand) / 0.7) 70deg, transparent 150deg)',
						animationDuration: '1s',
						animationPlayState: isActive ? 'running' : 'paused',
						opacity: isActive ? 1 : 0.25,
						transition: 'opacity 300ms',
					}}
				/>
			</div>
			<div className='absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60' />
		</div>
	)
}
