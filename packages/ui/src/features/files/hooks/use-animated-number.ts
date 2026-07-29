import {useEffect, useRef, useState} from 'react'

// Tweens a displayed number toward its target so values arriving in discrete
// snapshots (e.g. 1s progress ticks) read as continuous motion. Returns
// undefined while the target is undefined (indeterminate).
export function useAnimatedNumber(target: number | undefined, durationMs = 800): number | undefined {
	const [display, setDisplay] = useState(target)
	const displayRef = useRef(target)
	displayRef.current = display

	useEffect(() => {
		if (target === undefined) {
			setDisplay(undefined)
			return
		}
		const from = displayRef.current ?? target
		if (from === target) {
			setDisplay(target)
			return
		}
		const startedAt = performance.now()
		let frame: number
		const tick = (now: number) => {
			const progress = Math.min(1, (now - startedAt) / durationMs)
			setDisplay(from + (target - from) * progress)
			if (progress < 1) frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frame)
	}, [target, durationMs])

	return display
}
