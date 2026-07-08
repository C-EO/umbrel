import {tw} from '@/utils/tw'

/**
 * Canonical "embossed glass" treatment for the inner cells of desktop widgets —
 * stat cards, icon/emoji circles, mini-cards and buttons.
 *
 * Pure CSS, no backdrop-filter (these cells sit on real <Glass> already, and
 * nested backdrop-filters are a perf trap): a debossed well pressed into the
 * glass. The fill is a subtle dark tint (not a white sticker) that deepens
 * toward the top rim and lifts toward the bottom where light pools, while the
 * `glass-cell` boxShadow token adds the soft shadow under the top rim and the
 * bottom-lip edge.
 *
 * Interactive cells layer their hover/press feedback on top with a subtle
 * `brightness` shift rather than swapping the fill, so the glass read is kept.
 */
export const glassCellClass = tw`bg-linear-to-b from-white/[0.03] to-white/[0.09] shadow-glass-cell`

/** Hover/press feedback for interactive glass cells (buttons, mini-cards). */
export const glassCellInteractiveClass = tw`transition-[filter] hover:brightness-125 active:brightness-95`
