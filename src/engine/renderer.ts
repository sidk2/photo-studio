import { defaults, type Adjustments, type EditDocument } from './model'
import { canvas, context, drawMask } from './masks'
import { vertex, fragment } from './shaders'

export class PhotoRenderer {
  readonly canvas = canvas(1, 1)
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private source: WebGLTexture
  private mask: WebGLTexture
  private ping: WebGLTexture[]
  private frame: WebGLFramebuffer
  private buffer: WebGLBuffer
  private float: boolean
  private width = 0
  private height = 0
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private maskCache = new Map<string, HTMLCanvasElement>()
  constructor() {
    const gl = this.canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      antialias: false,
    })
    if (!gl)
      throw new Error(
        'Photo Studio needs WebGL 2. Enable graphics acceleration in your browser and reload.',
      )
    this.gl = gl
    this.float = !!gl.getExtension('EXT_color_buffer_float')
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`Image shader: ${gl.getShaderInfoLog(shader)}`)
      return shader
    }
    this.program = gl.createProgram()!
    const vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment)
    gl.attachShader(this.program, vs)
    gl.attachShader(this.program, fs)
    gl.linkProgram(this.program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error('Could not initialize the image renderer.')
    gl.useProgram(this.program)
    this.buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const attribute = gl.getAttribLocation(this.program, 'position')
    gl.enableVertexAttribArray(attribute)
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0)
    const texture = () => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.source = texture()
    this.mask = texture()
    this.ping = [texture(), texture()]
    this.frame = gl.createFramebuffer()!
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.uniform1i(this.location('image'), 0)
    gl.uniform1i(this.location('mask'), 1)
  }
  private location(name: string) {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name))
    return this.uniforms.get(name)!
  }
  private setAdjustments(a: Adjustments) {
    const gl = this.gl
    for (const [key, value] of Object.entries(a))
      if (key !== 'mixer') gl.uniform1f(this.location(key), value as number)
    gl.uniform3fv(
      this.location('mixer[0]'),
      new Float32Array(a.mixer.flatMap((b) => [b.hue, b.saturation, b.luminance])),
    )
  }
  render(
    source: HTMLCanvasElement,
    doc: EditDocument,
    fullSize = { width: source.width, height: source.height },
    origin = { x: 0, y: 0 },
    pixelScale = 1,
  ) {
    const gl = this.gl,
      w = source.width,
      h = source.height
    if (gl.isContextLost())
      throw new Error(
        'The graphics context was lost. Save your project and reload to resume editing.',
      )
    if (w > gl.getParameter(gl.MAX_TEXTURE_SIZE) || h > gl.getParameter(gl.MAX_TEXTURE_SIZE))
      throw new Error('This render is larger than your graphics hardware supports.')
    gl.useProgram(this.program)
    if (w !== this.width || h !== this.height) {
      this.canvas.width = w
      this.canvas.height = h
      this.width = w
      this.height = h
      for (const t of this.ping) {
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          this.float ? gl.RGBA16F : gl.RGBA8,
          w,
          h,
          0,
          gl.RGBA,
          this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
          null,
        )
      }
    }
    gl.viewport(0, 0, w, h)
    gl.uniform2f(this.location('texel'), 1 / w, 1 / h)
    gl.uniform2f(this.location('origin'), origin.x, origin.y)
    gl.uniform2f(this.location('fullSize'), fullSize.width, fullSize.height)
    gl.uniform2f(this.location('tileSize'), w, h)
    gl.uniform1f(this.location('pixelScale'), pixelScale)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.source)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    // Keep both samplers complete even when the global pass does not sample a mask.
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.mask)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    )
    const draw = (
      input: WebGLTexture,
      output: WebGLTexture | null,
      a: Adjustments,
      masked: boolean,
      copy: boolean,
      opacity: number,
    ) => {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, input)
      gl.bindFramebuffer(gl.FRAMEBUFFER, output ? this.frame : null)
      if (output) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('The graphics hardware cannot allocate this image. Try a smaller photo.')
      }
      this.setAdjustments(a)
      gl.uniform1i(this.location('useMask'), masked ? 1 : 0)
      gl.uniform1i(this.location('copyOnly'), copy ? 1 : 0)
      gl.uniform1f(this.location('opacity'), opacity)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    draw(this.source, this.ping[0], doc.adjustments, false, false, 1)
    let index = 0
    const used = new Set<string>()
    for (const m of doc.masks.filter((m) => m.enabled)) {
      const key = JSON.stringify([
        fullSize,
        origin,
        w,
        h,
        m.type,
        m.start,
        m.end,
        m.strokes,
        m.feather,
        m.inverted,
      ])
      used.add(key)
      let mask = this.maskCache.get(key)
      if (!mask) {
        mask = drawMask(m, fullSize.width, fullSize.height, {
          x: origin.x,
          y: origin.y,
          width: w,
          height: h,
        })
        this.maskCache.set(key, mask)
      }
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.mask)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask)
      draw(this.ping[index], this.ping[1 - index], m.adjustments, true, false, m.opacity / 100)
      index = 1 - index
    }
    for (const key of this.maskCache.keys()) if (!used.has(key)) this.maskCache.delete(key)
    draw(this.ping[index], null, defaults(), false, true, 1)
    return this.canvas
  }
  dispose() {
    const gl = this.gl
    for (const t of [this.source, this.mask, ...this.ping]) gl.deleteTexture(t)
    gl.deleteFramebuffer(this.frame)
    gl.deleteBuffer(this.buffer)
    gl.deleteProgram(this.program)
    this.maskCache.clear()
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

export function makePreview(bitmap: ImageBitmap, maxEdge = 1800) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const c = canvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  )
  const ctx = context(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, c.width, c.height)
  return c
}

// Keep crop/mask coordinates in the original image space. Geometry is applied last.
export function finishGeometry(source: HTMLCanvasElement, doc: EditDocument): HTMLCanvasElement {
  const crop = doc.crop,
    w = Math.max(1, Math.round(source.width * crop.w)),
    h = Math.max(1, Math.round(source.height * crop.h))
  const rotated = doc.rotation % 180 !== 0
  const result = canvas(rotated ? h : w, rotated ? w : h),
    ctx = context(result)
  ctx.translate(result.width / 2, result.height / 2)
  ctx.rotate((doc.rotation * Math.PI) / 180)
  ctx.scale(doc.flipX ? -1 : 1, doc.flipY ? -1 : 1)
  // Straightening scales around the crop center so it never creates empty corners.
  const angle = (doc.straighten * Math.PI) / 180
  const scale = Math.max(
    Math.abs(Math.cos(angle)) + (h / w) * Math.abs(Math.sin(angle)),
    Math.abs(Math.cos(angle)) + (w / h) * Math.abs(Math.sin(angle)),
  )
  ctx.rotate(angle)
  ctx.scale(scale, scale)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source,
    crop.x * source.width,
    crop.y * source.height,
    crop.w * source.width,
    crop.h * source.height,
    -w / 2,
    -h / 2,
    w,
    h,
  )
  return result
}

export async function renderFullImage(
  base: HTMLCanvasElement,
  doc: EditDocument,
  progress: (v: number) => void,
) {
  const renderer = new PhotoRenderer(),
    out = canvas(base.width, base.height),
    ctx = context(out)
  const tileSize = 1536
  // Each sharpen pass adds a neighborhood dependency. Halo width includes every pass.
  const halo =
    Math.ceil(
      doc.adjustments.radius +
        doc.masks.reduce((n, m) => n + (m.enabled ? m.adjustments.radius : 0), 0),
    ) + 3
  const total = Math.ceil(base.width / tileSize) * Math.ceil(base.height / tileSize)
  let done = 0
  try {
    for (let y = 0; y < base.height; y += tileSize)
      for (let x = 0; x < base.width; x += tileSize) {
        const left = Math.max(0, x - halo),
          top = Math.max(0, y - halo),
          right = Math.min(base.width, x + tileSize + halo),
          bottom = Math.min(base.height, y + tileSize + halo)
        const tile = canvas(right - left, bottom - top)
        context(tile).drawImage(base, -left, -top)
        const rendered = renderer.render(tile, doc, base, { x: left, y: top })
        const w = Math.min(tileSize, base.width - x),
          h = Math.min(tileSize, base.height - y)
        ctx.drawImage(rendered, x - left, y - top, w, h, x, y, w, h)
        tile.width = tile.height = 1
        progress(++done / total)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    return finishGeometry(out, doc)
  } finally {
    renderer.dispose()
    out.width = out.height = 1
  }
}
