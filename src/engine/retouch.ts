import { clamp, interpolatePoints, type Point, type Retouch } from './model'
import { canvas, context } from './masks'

export function chooseHealSource(base: HTMLCanvasElement, target: Point, size: number): Point {
  const ctx = context(base, true),
    { width: w, height: h } = base
  const radius = Math.max(2, (size * Math.min(w, h)) / 2),
    tx = target.x * w,
    ty = target.y * h
  const pixels = ctx.getImageData(0, 0, w, h).data
  const sample = (x: number, y: number) => {
    const idx = (Math.round(clamp(y, 0, h - 1)) * w + Math.round(clamp(x, 0, w - 1))) * 4
    return [pixels[idx], pixels[idx + 1], pixels[idx + 2]]
  }
  let best = { x: clamp(target.x + (radius * 3) / w), y: target.y },
    score = Infinity
  for (const distance of [2.8, 4.5])
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6,
        x = tx + Math.cos(angle) * radius * distance,
        y = ty + Math.sin(angle) * radius * distance
      if (x < radius || x > w - radius || y < radius || y > h - radius) continue
      let error = 0
      for (let j = 0; j < 12; j++) {
        const a = (j * Math.PI) / 6,
          dx = Math.cos(a) * radius * 0.9,
          dy = Math.sin(a) * radius * 0.9
        const t = sample(tx + dx, ty + dy),
          s = sample(x + dx, y + dy)
        for (let c = 0; c < 3; c++) error += (t[c] - s[c]) ** 2
      }
      if (error < score) {
        score = error
        best = { x: x / w, y: y / h }
      }
    }
  return best
}

export function applyRetouches(base: HTMLCanvasElement, strokes: Retouch[]): HTMLCanvasElement {
  const result = canvas(base.width, base.height),
    ctx = context(result, true)
  ctx.drawImage(base, 0, 0)
  const w = base.width,
    h = base.height
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    const radius = Math.max(1, (stroke.size * Math.min(w, h)) / 2)
    const offset = {
      x: (stroke.source.x - stroke.points[0].x) * w,
      y: (stroke.source.y - stroke.points[0].y) * h,
    }
    const points = interpolatePoints(stroke.points, (radius / h) * 0.35, w / h)
    // Snapshot only the sampled rectangle: a stroke never copies its own freshly painted pixels.
    const minX = Math.max(
      0,
      Math.floor(Math.min(...points.map((p) => p.x * w + offset.x)) - radius),
    )
    const minY = Math.max(
      0,
      Math.floor(Math.min(...points.map((p) => p.y * h + offset.y)) - radius),
    )
    const maxX = Math.min(
      w,
      Math.ceil(Math.max(...points.map((p) => p.x * w + offset.x)) + radius + 1),
    )
    const maxY = Math.min(
      h,
      Math.ceil(Math.max(...points.map((p) => p.y * h + offset.y)) + radius + 1),
    )
    if (maxX <= minX || maxY <= minY) continue
    const source = ctx.getImageData(minX, minY, maxX - minX, maxY - minY)
    for (const p of points) {
      const tx = p.x * w,
        ty = p.y * h
      const left = Math.max(0, Math.floor(tx - radius)),
        top = Math.max(0, Math.floor(ty - radius))
      const right = Math.min(w, Math.ceil(tx + radius)),
        bottom = Math.min(h, Math.ceil(ty + radius))
      if (right <= left || bottom <= top) continue
      const patch = ctx.getImageData(left, top, right - left, bottom - top)
      const difference = [0, 0, 0]
      let count = 0
      const sourceIndex = (x: number, y: number) => {
        const sx = Math.round(x + offset.x) - minX,
          sy = Math.round(y + offset.y) - minY
        return sx < 0 || sy < 0 || sx >= source.width || sy >= source.height
          ? -1
          : (sy * source.width + sx) * 4
      }
      if (stroke.mode === 'heal') {
        for (let y = 0; y < patch.height; y += 2)
          for (let x = 0; x < patch.width; x += 2) {
            const distance = Math.hypot(left + x - tx, top + y - ty) / radius
            if (distance < 0.72 || distance > 1) continue
            const s = sourceIndex(left + x, top + y),
              d = (y * patch.width + x) * 4
            if (s < 0 || source.data[s + 3] < 128 || patch.data[d + 3] < 128) continue
            for (let c = 0; c < 3; c++) difference[c] += patch.data[d + c] - source.data[s + c]
            count++
          }
      }
      const hardness = 1 - stroke.feather / 100
      for (let y = 0; y < patch.height; y++)
        for (let x = 0; x < patch.width; x++) {
          const distance = Math.hypot(left + x - tx, top + y - ty) / radius
          if (distance > 1) continue
          const s = sourceIndex(left + x, top + y),
            d = (y * patch.width + x) * 4
          if (s < 0 || source.data[s + 3] === 0) continue
          const edge = clamp((1 - distance) / Math.max(0.001, 1 - hardness))
          const amount =
            (((edge * edge * (3 - 2 * edge) * stroke.opacity) / 100) * source.data[s + 3]) / 255
          for (let c = 0; c < 3; c++) {
            const corrected = clamp(
              source.data[s + c] + (count ? difference[c] / count : 0),
              0,
              255,
            )
            patch.data[d + c] = patch.data[d + c] * (1 - amount) + corrected * amount
          }
        }
      ctx.putImageData(patch, left, top)
    }
  }
  return result
}
