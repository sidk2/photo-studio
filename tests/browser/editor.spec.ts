import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
async function openPhoto(page: Page, name = 'gray.png') {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(fixture(name))
  await expect(page.getByTestId('photo-canvas')).toBeVisible()
  await expect(page.getByText('Opening your photo…')).not.toBeVisible()
  await expect
    .poll(async () => page.getByTestId('photo-canvas').evaluate((c: HTMLCanvasElement) => c.width))
    .toBeGreaterThan(1)
}
async function pixel(page: Page, x = 0.5, y = 0.5) {
  return page
    .getByTestId('photo-canvas')
    .evaluate(
      (c: HTMLCanvasElement, p) =>
        Array.from(
          c
            .getContext('2d')!
            .getImageData(Math.floor(c.width * p.x), Math.floor(c.height * p.y), 1, 1).data,
        ),
      { x, y },
    )
}
async function number(page: Page, name: string, value: string) {
  const input = page.getByRole('spinbutton', { name: `${name} value`, exact: true })
  await input.fill(value)
  await input.press('Tab')
}
test('JPEG and PNG decode, expose, undo, compare and preserve transparency', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openPhoto(page)
  await expect.poll(async () => (await pixel(page))[0]).toBe(80)
  await number(page, 'Exposure', '1')
  await expect.poll(async () => (await pixel(page))[0]).toBeGreaterThan(105)
  await page.getByRole('button', { name: 'Compare original', exact: true }).click()
  await expect.poll(async () => (await pixel(page))[0]).toBe(80)
  await page.getByRole('button', { name: 'Compare original', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await pixel(page))[0]).toBe(80)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await pixel(page))[0]).toBeGreaterThan(105)
  expect(errors).toEqual([])
})
test('HEIC decoding works in Chromium without native HEIC support', async ({ page }) => {
  await openPhoto(page, 'orientation.heic')
  await expect(page.locator('.file-badge')).toHaveText('HEIC')
  const p = await pixel(page, 0.2, 0.2)
  expect(p[0]).toBeGreaterThan(150)
  expect(p[2]).toBeLessThan(75)
  await expect(page.getByTestId('photo-canvas')).toHaveJSProperty('width', 256)
})
test('JPEG decoder preserves channel order and top/bottom orientation', async ({ page }) => {
  await openPhoto(page, 'orientation.jpg')
  const p = await pixel(page, 0.2, 0.2)
  expect(p[0]).toBeGreaterThan(150)
  expect(p[2]).toBeLessThan(75)
})
test('JPEG EXIF rotation is applied during decoding', async ({ page }) => {
  await openPhoto(page, 'rotated.jpg')
  await expect(page.getByTestId('photo-canvas')).toHaveJSProperty('width', 192)
  await expect(page.getByTestId('photo-canvas')).toHaveJSProperty('height', 256)
  const p = await pixel(page, 0.8, 0.2)
  expect(p[0]).toBeGreaterThan(150)
  expect(p[2]).toBeLessThan(75)
})
test('brush masks change only painted areas and undo a whole stroke', async ({ page }) => {
  await openPhoto(page)
  await page.getByRole('button', { name: 'Brush', exact: true }).first().click()
  await page.getByLabel('Show overlay').uncheck()
  await number(page, 'Brush size', '30')
  const bounds = (await page.getByTestId('editing-surface').boundingBox())!
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await number(page, 'Exposure', '2')
  await expect.poll(async () => (await pixel(page))[0]).toBeGreaterThan(145)
  expect((await pixel(page, 0.05, 0.05))[0]).toBe(80)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await pixel(page))[0]).toBe(80)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await pixel(page))[0]).toBeGreaterThan(145)
})
test('gradient masks have a spatially varying effect', async ({ page }) => {
  await openPhoto(page)
  await page.getByRole('button', { name: 'Linear gradient', exact: true }).click()
  await page.getByLabel('Show overlay').uncheck()
  await number(page, 'Exposure', '2')
  await expect.poll(async () => (await pixel(page, 0.5, 0.1))[0]).toBeGreaterThan(145)
  expect((await pixel(page, 0.5, 0.9))[0]).toBe(80)
})
test('healing removes a synthetic blemish and can be undone', async ({ page }) => {
  await openPhoto(page, 'blemish.png')
  expect((await pixel(page))[0]).toBeLessThan(25)
  await page.getByRole('button', { name: 'Retouch', exact: true }).click()
  await number(page, 'Brush size', '18')
  const bounds = (await page.getByTestId('editing-surface').boundingBox())!
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect.poll(async () => (await pixel(page))[0]).toBeGreaterThan(120)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await pixel(page))[0]).toBeLessThan(25)
})
test('square crop, rotation and PNG export retain expected size and alpha', async ({ page }) => {
  await openPhoto(page, 'orientation.png')
  expect((await pixel(page, 0.8, 0.8))[3]).toBeCloseTo(128, -1)
  await page.getByRole('button', { name: 'Crop', exact: true }).click()
  await page.getByLabel('Aspect ratio').selectOption('1')
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click()
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click()
  await expect(page.getByTestId('photo-canvas')).toHaveJSProperty('width', 192)
  await expect(page.getByTestId('photo-canvas')).toHaveJSProperty('height', 192)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByLabel('Format', { exact: true }).selectOption('image/png')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('orientation-edited.png')
  const path = await file.path()
  expect(path).toBeTruthy()
  const { readFile } = await import('node:fs/promises')
  const data = await readFile(path!)
  expect(data.readUInt32BE(16)).toBe(192)
  expect(data.readUInt32BE(20)).toBe(192)
})
test('project save and reopen restores photo, masks and adjustments', async ({ page }) => {
  await openPhoto(page)
  await number(page, 'Exposure', '1.25')
  await page.getByRole('button', { name: 'Radial gradient', exact: true }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const project = await dl
  expect(project.suggestedFilename()).toMatch(/\.photostudio$/)
  // Downloads have temporary paths; provide the project filename when reopening.
  const { readFile } = await import('node:fs/promises')
  await page.getByTestId('file-input').setInputFiles({
    name: 'restored.photostudio',
    mimeType: 'application/x-photostudio',
    buffer: await readFile((await project.path())!),
  })
  await expect(page.getByRole('spinbutton', { name: 'Exposure value', exact: true })).toHaveValue(
    '1.25',
  )
  await page.getByRole('button', { name: 'Radial gradient', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Mask name' })).toHaveValue('Radial gradient 1')
})
test('session resumes after a browser reload', async ({ page }) => {
  await openPhoto(page)
  await number(page, 'Exposure', '1.5')
  await expect(page.getByText('Saved on this device')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Continue your last session/ }).click()
  await expect(page.getByRole('spinbutton', { name: 'Exposure value', exact: true })).toHaveValue(
    '1.5',
  )
})
test('the interface is usable at desktop and narrow sizes', async ({ page }) => {
  await page.goto('/')
  await page.screenshot({ path: 'artifacts/welcome.png', fullPage: true })
  await page.getByTestId('file-input').setInputFiles(fixture('orientation.png'))
  await expect(page.getByTestId('photo-canvas')).toBeVisible()
  await expect(page.getByText('Opening your photo…')).not.toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'artifacts/editor.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('brush coordinates stay attached to the image after crop, rotation and zoom', async ({
  page,
}) => {
  await openPhoto(page)
  await page.getByRole('button', { name: 'Crop', exact: true }).click()
  await page.getByLabel('Aspect ratio').selectOption('1')
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click()
  await number(page, 'Straighten', '7')
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Brush', exact: true }).first().click()
  await page.getByLabel('Show overlay').uncheck()
  await number(page, 'Brush size', '12')
  const bounds = (await page.getByTestId('editing-surface').boundingBox())!
  await page.mouse.click(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.6)
  await number(page, 'Exposure', '2')
  await expect.poll(async () => (await pixel(page, 0.4, 0.6))[0]).toBeGreaterThan(150)
  expect((await pixel(page, 0.85, 0.85))[0]).toBe(80)
})
test('manual cloning samples from the selected source', async ({ page }) => {
  await openPhoto(page, 'orientation.png')
  await page.getByRole('button', { name: 'Retouch', exact: true }).click()
  await page.getByRole('button', { name: 'Clone', exact: true }).click()
  await number(page, 'Brush size', '20')
  const bounds = (await page.getByTestId('editing-surface').boundingBox())!
  await page.getByRole('button', { name: 'Choose source in photo', exact: true }).click()
  await page.mouse.click(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.2)
  await page.mouse.click(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.8)
  await expect.poll(async () => (await pixel(page, 0.2, 0.8))[0]).toBeGreaterThan(180)
  expect((await pixel(page, 0.2, 0.8))[2]).toBeLessThan(60)
})
test('malformed projects report an error and leave the current photo intact', async ({ page }) => {
  await openPhoto(page)
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.photostudio',
    mimeType: 'application/x-photostudio',
    buffer: Buffer.from('not-a-project'),
  })
  await expect(page.getByRole('alert')).toContainText('not a valid Photo Studio project')
  expect((await pixel(page))[0]).toBe(80)
})

test('editing and HEIC decoding make no external network requests', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173/'))
      external.push(request.url())
  })
  await openPhoto(page, 'orientation.heic')
  await number(page, 'Exposure', '1')
  await expect(page.getByText('Saved on this device')).toBeVisible()
  expect(external).toEqual([])
})
