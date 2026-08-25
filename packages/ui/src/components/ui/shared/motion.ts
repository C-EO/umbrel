// Shared motion timing (originally from Machines). One easing for layout
// morphs so shared-element glides and container resizes across features all
// move in lockstep.
export const layoutMorphTransition = {
	layout: {duration: 0.35, ease: [0.32, 0.72, 0, 1] as [number, number, number, number]},
}
