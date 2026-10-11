import { expect, test } from '@playwright/test'

test('GPU transforms preserve orientation, apply local masks, and invert masks', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { PhotoRenderer } = await import('/src/engine/renderer.ts')
    const { newDocument, newMask } = await import('/src/engine/model.ts')
    const { canvas, context } = await import('/src/engine/masks.ts')
    const c = canvas(100, 80),
      ctx = context(c)
    ctx.fillStyle = 'rgb(80,80,80)'
    ctx.fillRect(0, 0, 100, 80)
    ctx.fillStyle = 'red'
    ctx.fillRect(0, 0, 10, 10)
    const renderer = new PhotoRenderer(),
      d = newDocument(),
      read = (x: number, y: number) => {
        const o = canvas(100, 80)
        context(o).drawImage(renderer.render(c, d), 0, 0)
        return Array.from(context(o).getImageData(x, y, 1, 1).data)
      }
    const originalTop = read(5, 5),
      originalBottom = read(5, 75)
    d.adjustments.exposure = 1
    const brighter = read(50, 40)
    d.adjustments.exposure = 0
    const m = newMask('linear', 0)
    m.start = { x: 0.5, y: 0.25 }
    m.end = { x: 0.5, y: 0.75 }
    m.adjustments.exposure = 2
    d.masks = [m]
    const top = read(50, 5),
      bottom = read(50, 75)
    m.inverted = true
    const invertedTop = read(50, 5),
      invertedBottom = read(50, 75)
    renderer.dispose()
    return { originalTop, originalBottom, brighter, top, bottom, invertedTop, invertedBottom }
  })
  expect(result.originalTop[0]).toBe(255)
  expect(result.originalTop[2]).toBe(0)
  expect(result.originalBottom[0]).toBe(80)
  expect(result.brighter[0]).toBeGreaterThan(108)
  expect(result.top[0]).toBeGreaterThan(150)
  expect(result.bottom[0]).toBe(80)
  expect(result.invertedTop[0]).toBe(80)
  expect(result.invertedBottom[0]).toBeGreaterThan(150)
})
test('full-resolution tiled export matches a single render across a tile seam', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { PhotoRenderer, renderFullImage } = await import('/src/engine/renderer.ts')
    const { newDocument, newMask } = await import('/src/engine/model.ts')
    const { canvas, context } = await import('/src/engine/masks.ts')
    const c = canvas(1800, 90),
      ctx = context(c),
      pixels = ctx.createImageData(c.width, c.height)
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4
        pixels.data[i] = 30 + ((x * 19 + y * 7) % 160)
        pixels.data[i + 1] = 40 + ((x * 3 + y * 13) % 130)
        pixels.data[i + 2] = 50 + ((x * 11 + y * 3) % 100)
        pixels.data[i + 3] = 255
      }
    ctx.putImageData(pixels, 0, 0)
    const d = newDocument()
    d.adjustments.exposure = 0.5
    d.adjustments.sharpness = 40
    d.adjustments.radius = 2.3
    d.adjustments.vignette = 22
    const m = newMask('linear', 0)
    m.start = { x: 0.65, y: 0.5 }
    m.end = { x: 0.95, y: 0.5 }
    m.adjustments.exposure = 0.25
    m.adjustments.sharpness = 30
    m.adjustments.radius = 1.6
    d.masks = [m]
    const renderer = new PhotoRenderer(),
      whole = canvas(c.width, c.height)
    context(whole).drawImage(renderer.render(c, d), 0, 0)
    const tiled = await renderFullImage(c, d, () => {}),
      a = context(whole).getImageData(0, 0, c.width, c.height).data,
      b = context(tiled).getImageData(0, 0, c.width, c.height).data
    let max = 0,
      seam = 0,
      total = 0
    for (let i = 0; i < a.length; i++) {
      const delta = Math.abs(a[i] - b[i])
      max = Math.max(max, delta)
      total += delta
      const x = Math.floor(i / 4) % c.width
      if (x >= 1530 && x < 1542) seam = Math.max(seam, delta)
    }
    renderer.dispose()
    return { max, seam, average: total / a.length, width: tiled.width, height: tiled.height }
  })
  expect(result.width).toBe(1800)
  expect(result.height).toBe(90)
  expect(result.average).toBeLessThan(0.3)
  expect(result.seam).toBeLessThanOrEqual(3)
})
test('healing and cloning repair pixels, and mask erasing removes coverage', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { applyRetouches, chooseHealSource } = await import('/src/engine/retouch.ts')
    const { newMask } = await import('/src/engine/model.ts')
    const { canvas, context, drawMask } = await import('/src/engine/masks.ts')
    const c = canvas(200, 200),
      ctx = context(c)
    ctx.fillStyle = 'rgb(140,110,90)'
    ctx.fillRect(0, 0, 200, 200)
    ctx.fillStyle = 'rgb(10,10,10)'
    ctx.fillRect(95, 95, 10, 10)
    const source = chooseHealSource(c, { x: 0.5, y: 0.5 }, 0.2)
    const healed = applyRetouches(c, [
      {
        id: 'a',
        mode: 'heal',
        points: [{ x: 0.5, y: 0.5 }],
        source,
        size: 0.2,
        feather: 70,
        opacity: 100,
      },
    ])
    const clone = applyRetouches(c, [
      {
        id: 'b',
        mode: 'clone',
        points: [{ x: 0.5, y: 0.5 }],
        source: { x: 0.2, y: 0.2 },
        size: 0.2,
        feather: 70,
        opacity: 100,
      },
    ])
    const m = newMask('brush', 0)
    m.strokes = [
      { points: [{ x: 0.5, y: 0.5 }], size: 0.2, feather: 0, flow: 100, erase: false },
      { points: [{ x: 0.5, y: 0.5 }], size: 0.1, feather: 0, flow: 100, erase: true },
    ]
    const mask = drawMask(m, 200, 200)
    return {
      healed: Array.from(context(healed).getImageData(100, 100, 1, 1).data),
      cloned: Array.from(context(clone).getImageData(100, 100, 1, 1).data),
      erased: context(mask).getImageData(100, 100, 1, 1).data[3],
      edge: context(mask).getImageData(115, 100, 1, 1).data[3],
    }
  })
  expect(result.healed.slice(0, 3)).toEqual([140, 110, 90])
  expect(result.cloned.slice(0, 3)).toEqual([140, 110, 90])
  expect(result.erased).toBe(0)
  expect(result.edge).toBe(255)
})

test('hue, white balance, saturation and alpha survive the export pipeline', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { PhotoRenderer, renderFullImage } = await import('/src/engine/renderer.ts')
    const { newDocument } = await import('/src/engine/model.ts')
    const { canvas, context } = await import('/src/engine/masks.ts')
    const { canvasBlob } = await import('/src/engine/io.ts')
    const c = canvas(32, 32),
      ctx = context(c)
    ctx.fillStyle = 'red'
    ctx.fillRect(0, 0, 32, 16)
    ctx.fillStyle = 'rgba(80,80,80,.5)'
    ctx.fillRect(0, 16, 32, 16)
    const renderer = new PhotoRenderer(),
      d = newDocument(),
      read = (x: number, y: number) => {
        const o = canvas(32, 32)
        context(o).drawImage(renderer.render(c, d), 0, 0)
        return Array.from(context(o).getImageData(x, y, 1, 1).data)
      }
    d.adjustments.hue = 120
    const hue = read(8, 8)
    d.adjustments.hue = 0
    d.adjustments.saturation = -100
    const saturation = read(8, 8)
    d.adjustments.saturation = 0
    d.adjustments.temperature = 80
    const warmth = read(8, 24)
    d.adjustments.temperature = 0
    d.rotation = 90
    const exported = await renderFullImage(c, d, () => {}),
      blob = await canvasBlob(exported, 'image/png'),
      bitmap = await createImageBitmap(blob),
      decoded = canvas(32, 32)
    context(decoded).drawImage(bitmap, 0, 0)
    const alpha = Array.from(context(decoded).getImageData(8, 8, 1, 1).data)
    renderer.dispose()
    bitmap.close()
    return { hue, saturation, warmth, alpha }
  })
  expect(result.hue[1]).toBeGreaterThan(250)
  expect(result.hue[0]).toBeLessThan(3)
  expect(Math.abs(result.saturation[0] - result.saturation[1])).toBeLessThanOrEqual(1)
  expect(result.warmth[0]).toBeGreaterThan(result.warmth[2])
  expect(result.alpha[3]).toBe(128)
})

test('a 12-megapixel image exports at original resolution with local edits', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { renderFullImage } = await import('/src/engine/renderer.ts')
    const { newDocument, newMask } = await import('/src/engine/model.ts')
    const { canvas, context } = await import('/src/engine/masks.ts')
    const { canvasBlob } = await import('/src/engine/io.ts')
    const c = canvas(4032, 3024),
      ctx = context(c),
      g = ctx.createLinearGradient(0, 0, 4032, 3024)
    g.addColorStop(0, '#576b83')
    g.addColorStop(1, '#82754f')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, c.width, c.height)
    const d = newDocument()
    d.adjustments.exposure = 0.5
    d.adjustments.sharpness = 30
    const m = newMask('radial', 0)
    m.adjustments.exposure = 0.5
    d.masks = [m]
    const start = performance.now()
    let lastProgress = 0
    const out = await renderFullImage(c, d, (v) => (lastProgress = v)),
      blob = await canvasBlob(out, 'image/jpeg', 0.92),
      decoded = await createImageBitmap(blob)
    const result = {
      width: decoded.width,
      height: decoded.height,
      bytes: blob.size,
      seconds: (performance.now() - start) / 1000,
      progress: lastProgress,
    }
    decoded.close()
    c.width = c.height = 1
    out.width = out.height = 1
    return result
  })
  expect(result.width).toBe(4032)
  expect(result.height).toBe(3024)
  expect(result.bytes).toBeGreaterThan(10000)
  expect(result.progress).toBe(1)
  test
    .info()
    .annotations.push({
      type: '12MP export',
      description: `${result.seconds.toFixed(2)} seconds; ${result.bytes} bytes`,
    })
})
