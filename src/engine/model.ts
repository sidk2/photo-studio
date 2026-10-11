export type Point = { x: number; y: number }
export type Crop = { x: number; y: number; w: number; h: number }
export type ColorBand = { hue: number; saturation: number; luminance: number }
export type Adjustments = {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  saturation: number
  vibrance: number
  hue: number
  value: number
  sharpness: number
  radius: number
  vignette: number
  mixer: ColorBand[]
}
export type Stroke = {
  points: Point[]
  size: number
  feather: number
  flow: number
  erase: boolean
}
export type Mask = {
  id: string
  name: string
  type: 'brush' | 'linear' | 'radial'
  enabled: boolean
  inverted: boolean
  opacity: number
  feather: number
  start: Point
  end: Point
  strokes: Stroke[]
  adjustments: Adjustments
}
export type Retouch = {
  id: string
  mode: 'heal' | 'clone'
  points: Point[]
  source: Point
  size: number
  feather: number
  opacity: number
}
export type EditDocument = {
  version: 1
  adjustments: Adjustments
  masks: Mask[]
  retouches: Retouch[]
  crop: Crop
  rotation: number
  straighten: number
  flipX: boolean
  flipY: boolean
}
export type Photo = {
  name: string
  type: string
  width: number
  height: number
  bitmap: ImageBitmap
  blob: Blob
  url: string
}
export const BAND_COLORS = [
  '#e55d54',
  '#e5a05d',
  '#e0d15e',
  '#85b879',
  '#6ec3c6',
  '#688bd4',
  '#a583d2',
  '#ce84b9',
]
export const BAND_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']
export const BAND_HUES = [0, 30, 60, 120, 180, 240, 270, 300]
export const clamp = (v: number, low = 0, high = 1) => Math.max(low, Math.min(high, v))
export function defaults(): Adjustments {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    hue: 0,
    value: 0,
    sharpness: 0,
    radius: 1.2,
    vignette: 0,
    mixer: BAND_NAMES.map(() => ({ hue: 0, saturation: 0, luminance: 0 })),
  }
}
export function newDocument(): EditDocument {
  return {
    version: 1,
    adjustments: defaults(),
    masks: [],
    retouches: [],
    crop: { x: 0, y: 0, w: 1, h: 1 },
    rotation: 0,
    straighten: 0,
    flipX: false,
    flipY: false,
  }
}
export function newMask(type: Mask['type'], count: number): Mask {
  return {
    id: crypto.randomUUID(),
    name: `${type === 'linear' ? 'Linear gradient' : type === 'radial' ? 'Radial gradient' : 'Brush'} ${count + 1}`,
    type,
    enabled: true,
    inverted: false,
    opacity: 100,
    feather: 75,
    start: { x: 0.5, y: type === 'radial' ? 0.5 : 0.3 },
    end: { x: type === 'radial' ? 0.72 : 0.5, y: 0.7 },
    strokes: [],
    adjustments: defaults(),
  }
}
export function cropForRatio(ratio: number | null, imageRatio: number, current: Crop): Crop {
  if (!ratio) return current
  const normalized = ratio / imageRatio
  let w = current.w,
    h = w / normalized
  if (h > current.h) {
    h = current.h
    w = h * normalized
  }
  return { x: current.x + (current.w - w) / 2, y: current.y + (current.h - h) / 2, w, h }
}
export function interpolatePoints(points: Point[], spacing: number, aspect: number): Point[] {
  if (!points.length) return []
  const result = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    const distance = Math.hypot((b.x - a.x) * aspect, b.y - a.y)
    const n = Math.max(1, Math.ceil(distance / Math.max(0.0001, spacing)))
    for (let j = 1; j <= n; j++)
      result.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n })
  }
  return result
}
export function outputDimensions(width: number, height: number, doc: EditDocument) {
  const w = Math.max(1, Math.round(width * doc.crop.w)),
    h = Math.max(1, Math.round(height * doc.crop.h))
  return doc.rotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w }
}

// Files are untrusted: reject malformed/oversized edit graphs before rendering them.
export function validateDocument(input: unknown): EditDocument {
  const d = input as EditDocument
  const finite = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  const point = (p: Point) => p && finite(p.x, 0, 1) && finite(p.y, 0, 1)
  function adjustment(a: Adjustments) {
    if (!a || !Array.isArray(a.mixer) || a.mixer.length !== 8) return false
    const def = defaults()
    return (
      Object.keys(def)
        .filter((k) => k !== 'mixer')
        .every((k) =>
          finite(
            a[k as keyof Adjustments],
            k === 'radius'
              ? 0.1
              : k === 'sharpness'
                ? 0
                : k === 'exposure'
                  ? -5
                  : k === 'hue'
                    ? -180
                    : -100,
            k === 'radius' ? 5 : k === 'exposure' ? 5 : k === 'hue' ? 180 : 100,
          ),
        ) &&
      a.mixer.every(
        (b) =>
          b &&
          finite(b.hue, -100, 100) &&
          finite(b.saturation, -100, 100) &&
          finite(b.luminance, -100, 100),
      )
    )
  }
  if (
    !d ||
    d.version !== 1 ||
    !adjustment(d.adjustments) ||
    !d.crop ||
    !finite(d.crop.x, 0, 1) ||
    !finite(d.crop.y, 0, 1) ||
    !finite(d.crop.w, 0.001, 1) ||
    !finite(d.crop.h, 0.001, 1) ||
    d.crop.x + d.crop.w > 1.00001 ||
    d.crop.y + d.crop.h > 1.00001 ||
    ![0, 90, 180, 270].includes(d.rotation) ||
    !finite(d.straighten, -15, 15) ||
    typeof d.flipX !== 'boolean' ||
    typeof d.flipY !== 'boolean' ||
    !Array.isArray(d.masks) ||
    d.masks.length > 30 ||
    !Array.isArray(d.retouches) ||
    d.retouches.length > 500
  )
    throw new Error('This project contains invalid edit settings.')
  let pointCount = 0
  for (const m of d.masks) {
    if (
      !m ||
      typeof m.id !== 'string' ||
      typeof m.name !== 'string' ||
      m.name.length > 100 ||
      !['brush', 'linear', 'radial'].includes(m.type) ||
      typeof m.enabled !== 'boolean' ||
      typeof m.inverted !== 'boolean' ||
      !finite(m.opacity, 0, 100) ||
      !finite(m.feather, 0, 100) ||
      !point(m.start) ||
      !point(m.end) ||
      !adjustment(m.adjustments) ||
      !Array.isArray(m.strokes) ||
      m.strokes.length > 2000
    )
      throw new Error('This project contains an invalid mask.')
    for (const s of m.strokes) {
      if (
        !Array.isArray(s.points) ||
        !s.points.every(point) ||
        !finite(s.size, 0.001, 0.5) ||
        !finite(s.feather, 0, 100) ||
        !finite(s.flow, 0, 100) ||
        typeof s.erase !== 'boolean'
      )
        throw new Error('This project contains an invalid brush stroke.')
      pointCount += s.points.length
    }
  }
  for (const r of d.retouches) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !['heal', 'clone'].includes(r.mode) ||
      !Array.isArray(r.points) ||
      !r.points.length ||
      !r.points.every(point) ||
      !point(r.source) ||
      !finite(r.size, 0.001, 0.5) ||
      !finite(r.feather, 0, 100) ||
      !finite(r.opacity, 0, 100)
    )
      throw new Error('This project contains an invalid retouch stroke.')
    pointCount += r.points.length
  }
  if (pointCount > 200000) throw new Error('This project has too many brush points to open safely.')
  return structuredClone(d)
}
