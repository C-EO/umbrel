import {describe, expect, it} from 'vitest'

import {overTile} from './picture-flight'

describe('overTile', () => {
	it('maps a landscape picture’s centre square onto the tile, corners included', () => {
		const to = {left: 100, top: 100, width: 400, height: 300}
		const from = {left: 10, top: 20, width: 60, height: 60, radius: 6}
		expect(overTile(to, from)).toEqual({
			// Crop is 300×300 at x 50: scale 0.2 puts it at the tile once the
			// picture is moved so that (100 + 50·0.2, 100) lands on (10, 20)
			transform: 'translate(-100px, -80px) scale(0.2)',
			clipPath: 'inset(0px 50px round 30px)',
		})
	})

	it('crops a portrait picture top and bottom', () => {
		const {clipPath} = overTile(
			{left: 0, top: 0, width: 300, height: 500},
			{left: 0, top: 0, width: 150, height: 150, radius: 0},
		)
		expect(clipPath).toBe('inset(100px 0px round 0px)')
	})
})
