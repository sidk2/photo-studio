import { describe, expect, it } from 'vitest'
import {
  cropForRatio,
  interpolatePoints,
  newDocument,
  newMask,
  outputDimensions,
  validateDocument,
} from '../../src/engine/model'

describe('photo geometry', () => {
  it('fits a square crop in a landscape image and keeps it centered', () => {
    const c = cropForRatio(1, 1.5, { x: 0, y: 0, w: 1, h: 1 })
    expect(c.w).toBeCloseTo(2 / 3)
    expect(c.h).toBe(1)
    expect(c.x).toBeCloseTo(1 / 6)
  })
  it('keeps portrait crop dimensions correct through quarter turns', () => {
    const d = newDocument()
    d.crop = cropForRatio(4 / 5, 3 / 2, d.crop)
    expect(outputDimensions(6000, 4000, d)).toEqual({ width: 3200, height: 4000 })
    d.rotation = 90
    expect(outputDimensions(6000, 4000, d)).toEqual({ width: 4000, height: 3200 })
  })
  it('resamples sparse brush movement in image pixel space', () => {
    const points = interpolatePoints(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      0.1,
      2,
    )
    expect(points).toHaveLength(21)
    expect(points.at(-1)).toEqual({ x: 1, y: 0 })
  })
})
describe('project validation', () => {
  it('round trips an edited document without retaining mutable references', () => {
    const d = newDocument()
    d.masks.push(newMask('radial', 0))
    d.adjustments.exposure = 1.2
    const copy = validateDocument(d)
    expect(copy).toEqual(d)
    copy.adjustments.exposure = 2
    expect(d.adjustments.exposure).toBe(1.2)
  })
  it('rejects invalid crops, nonfinite sliders, excessive graphs, and malformed points', () => {
    const d = newDocument()
    d.crop.x = 0.6
    expect(() => validateDocument(d)).toThrow()
    d.crop.x = 0
    d.adjustments.exposure = NaN
    expect(() => validateDocument(d)).toThrow()
    d.adjustments.exposure = 0
    d.masks = Array.from({ length: 31 }, () => newMask('brush', 0))
    expect(() => validateDocument(d)).toThrow()
    d.masks = [newMask('brush', 0)]
    d.masks[0].strokes = [
      { points: [{ x: 2, y: 0 }], size: 0.1, feather: 50, flow: 100, erase: false },
    ]
    expect(() => validateDocument(d)).toThrow()
  })
})
