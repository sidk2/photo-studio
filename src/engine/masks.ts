import { interpolatePoints, type Mask } from './model'

export function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}
export function context(c: HTMLCanvasElement, read = false) {
  const ctx = c.getContext('2d', { willReadFrequently: read })
  if (!ctx) throw new Error('Your browser could not create an image canvas.')
  return ctx
}
export function drawMask(
  mask: Mask,
  width: number,
  height: number,
  region = { x: 0, y: 0, width, height },
): HTMLCanvasElement {
  const result = canvas(region.width, region.height),
    ctx = context(result)
  ctx.translate(-region.x, -region.y)
  const a = { x: mask.start.x * width, y: mask.start.y * height }
  const b = { x: mask.end.x * width, y: mask.end.y * height }
  if (mask.type === 'linear') {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) b.y += 1
    const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
    gradient.addColorStop(0, 'white')
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.fillRect(region.x, region.y, region.width, region.height)
  } else if (mask.type === 'radial') {
    ctx.save()
    ctx.translate(a.x, a.y)
    ctx.scale(
      Math.max(Math.abs(b.x - a.x), width * 0.005),
      Math.max(Math.abs(b.y - a.y), height * 0.005),
    )
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    gradient.addColorStop(0, 'white')
    gradient.addColorStop(Math.min(0.999, 1 - mask.feather / 100), 'white')
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.fillRect(-1, -1, 2, 2)
    ctx.restore()
  } else {
    for (const stroke of mask.strokes) {
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
      ctx.globalAlpha = stroke.flow / 100
      const radius = (stroke.size * Math.min(width, height)) / 2
      for (const p of interpolatePoints(
        stroke.points,
        ((stroke.size * Math.min(width, height)) / height) * 0.16,
        width / height,
      )) {
        const x = p.x * width,
          y = p.y * height
        if (
          x + radius < region.x ||
          x - radius > region.x + region.width ||
          y + radius < region.y ||
          y - radius > region.y + region.height
        )
          continue
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(radius, 0.1))
        gradient.addColorStop(0, 'white')
        gradient.addColorStop(Math.min(0.999, 1 - stroke.feather / 100), 'white')
        gradient.addColorStop(1, 'transparent')
        ctx.fillStyle = gradient
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (mask.inverted) {
    ctx.globalCompositeOperation = 'source-out'
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, result.width, result.height)
  }
  return result
}
