import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clamp,
  type Crop,
  type EditDocument,
  type Mask,
  type Photo,
  type Point,
  type Retouch,
  type Stroke,
} from '../engine/model'
import { canvas, context, drawMask } from '../engine/masks'
import { applyRetouches, chooseHealSource } from '../engine/retouch'
import { finishGeometry, makePreview, PhotoRenderer } from '../engine/renderer'

export type Tool = 'edit' | 'crop' | 'brush' | 'linear' | 'radial' | 'heal' | 'clone' | 'hand'
export type BrushSettings = { size: number; feather: number; flow: number; erase: boolean }
type Props = {
  photo: Photo
  doc: EditDocument
  tool: Tool
  activeMask: string | null
  brush: BrushSettings
  overlay: boolean
  before: boolean
  zoom: number
  ratio: number | null
  source: Point | null
  pickingSource: boolean
  onSource: (p: Point) => void
  onChange: (fn: (d: EditDocument) => EditDocument, transient?: boolean) => void
  onBegin: () => void
  onCommit: () => void
  onRender: (c: HTMLCanvasElement) => void
  onError: (message: string) => void
}
type Gesture = {
  kind: 'brush' | 'retouch' | 'gradient' | 'crop' | 'pan'
  start: Point
  crop?: Crop
  corner?: string
  index?: number
  part?: 'start' | 'end' | 'draw'
  pan?: Point
}

export default function EditorCanvas(props: Props) {
  const {
    photo,
    doc,
    tool,
    activeMask,
    brush,
    overlay,
    before,
    zoom,
    ratio,
    source,
    pickingSource,
    onSource,
    onChange,
    onBegin,
    onCommit,
    onRender,
    onError,
  } = props
  const output = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    renderer = useRef<PhotoRenderer | null>(null)
  const gesture = useRef<Gesture | null>(null),
    propsRef = useRef(props)
  propsRef.current = props
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 }),
    [view, setView] = useState({ width: 1, height: 1 })
  const [cursor, setCursor] = useState<Point | null>(null),
    [pan, setPan] = useState<Point>({ x: 0, y: 0 }),
    [space, setSpace] = useState(false)
  const coordinateView = tool === 'crop'
  const original = useMemo(
    () => makePreview(photo.bitmap, zoom > 1 ? Math.min(4096, 1800 * zoom) : 1800),
    [photo, zoom],
  )
  const prefix = doc.retouches.slice(0, -1),
    prefixKey = JSON.stringify(prefix)
  const committedRetouches = useMemo(
    () => (prefix.length ? applyRetouches(original, prefix) : original),
    [original, prefixKey],
  )
  const lastRetouch = doc.retouches.at(-1),
    lastKey = JSON.stringify(lastRetouch)
  const retouched = useMemo(
    () => (lastRetouch ? applyRetouches(committedRetouches, [lastRetouch]) : committedRetouches),
    [committedRetouches, lastKey],
  )
  const selected = doc.masks.find((m) => m.id === activeMask)
  useEffect(() => {
    try {
      renderer.current = new PhotoRenderer()
    } catch (error) {
      onError((error as Error).message)
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false)
    }
    const blur = () => setSpace(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  useEffect(() => {
    setPan({ x: 0, y: 0 })
  }, [photo, zoom, tool === 'crop'])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!renderer.current || !output.current) return
      try {
        const rendered = before
          ? original
          : renderer.current.render(
              retouched,
              doc,
              retouched,
              { x: 0, y: 0 },
              original.width / photo.width,
            )
        const raw = canvas(original.width, original.height)
        context(raw).drawImage(rendered, 0, 0)
        const finished = coordinateView ? raw : finishGeometry(raw, doc)
        output.current.width = finished.width
        output.current.height = finished.height
        const ctx = context(output.current)
        ctx.drawImage(finished, 0, 0)
        onRender(finished)
        if (overlay && selected && !before && ['brush', 'linear', 'radial'].includes(tool)) {
          const mask = drawMask(selected, original.width, original.height),
            maskCtx = context(mask)
          maskCtx.globalCompositeOperation = 'source-in'
          maskCtx.fillStyle = 'rgba(223,89,89,.46)'
          maskCtx.fillRect(0, 0, mask.width, mask.height)
          const transformed = coordinateView ? mask : finishGeometry(mask, doc)
          ctx.drawImage(transformed, 0, 0)
        }
        setView((old) =>
          old.width === finished.width && old.height === finished.height
            ? old
            : { width: finished.width, height: finished.height },
        )
      } catch (error) {
        onError((error as Error).message)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [doc, original, retouched, overlay, selected, before, coordinateView, tool])
  const fit = Math.min(
    (dimensions.width - 80) / view.width,
    (dimensions.height - 80) / view.height,
    1,
  )
  const displayScale = Math.max(0.01, fit * zoom)
  const display = { width: view.width * displayScale, height: view.height * displayScale }
  function matrix() {
    if (coordinateView) return new DOMMatrix()
    const w = original.width * doc.crop.w,
      h = original.height * doc.crop.h,
      angle = (doc.straighten * Math.PI) / 180
    const scale = Math.max(
      Math.abs(Math.cos(angle)) + (h / w) * Math.abs(Math.sin(angle)),
      Math.abs(Math.cos(angle)) + (w / h) * Math.abs(Math.sin(angle)),
    )
    return new DOMMatrix()
      .translate(view.width / 2, view.height / 2)
      .rotate(doc.rotation)
      .scale(doc.flipX ? -1 : 1, doc.flipY ? -1 : 1)
      .rotate(doc.straighten)
      .scale(scale)
      .translate(
        -(doc.crop.x + doc.crop.w / 2) * original.width,
        -(doc.crop.y + doc.crop.h / 2) * original.height,
      )
  }
  const imageToView = (p: Point) =>
    new DOMPoint(p.x * original.width, p.y * original.height).matrixTransform(matrix())
  function eventPoint(e: ReactPointerEvent): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    const p = new DOMPoint(
      ((e.clientX - rect.left) / rect.width) * view.width,
      ((e.clientY - rect.top) / rect.height) * view.height,
    ).matrixTransform(matrix().inverse())
    return { x: clamp(p.x / original.width), y: clamp(p.y / original.height) }
  }
  const updateMask = (fn: (m: Mask) => Mask) =>
    onChange((d) => ({ ...d, masks: d.masks.map((m) => (m.id === activeMask ? fn(m) : m)) }), true)
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = eventPoint(e)
    if (tool === 'hand' || space || e.button === 1) {
      gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, pan }
      return
    }
    if (before) return
    if (tool === 'heal' || tool === 'clone') {
      if (e.altKey || pickingSource || (tool === 'clone' && !source)) {
        onSource(p)
        return
      }
      if (doc.retouches.length >= 500) {
        onError('This version supports up to 500 retouch strokes per photo.')
        return
      }
      onBegin()
      const picked = source || chooseHealSource(retouched, p, brush.size)
      const stroke: Retouch = {
        id: crypto.randomUUID(),
        mode: tool,
        source: picked,
        points: [p],
        size: brush.size,
        feather: brush.feather,
        opacity: brush.flow,
      }
      gesture.current = { kind: 'retouch', start: p, index: doc.retouches.length }
      onChange((d) => ({ ...d, retouches: [...d.retouches, stroke] }), true)
    } else if (tool === 'brush' && selected?.type === 'brush') {
      if (selected.strokes.length >= 2000) {
        onError('This mask has reached its stroke limit. Create another brush mask to continue.')
        return
      }
      onBegin()
      const stroke: Stroke = { ...brush, points: [p], erase: brush.erase || e.altKey }
      gesture.current = { kind: 'brush', start: p, index: selected.strokes.length }
      updateMask((m) => ({ ...m, strokes: [...m.strokes, stroke] }))
    } else if ((tool === 'linear' || tool === 'radial') && selected) {
      onBegin()
      const screen = imageToView(p),
        a = imageToView(selected.start),
        b = imageToView(selected.end)
      const distance = (q: Point) => Math.hypot(screen.x - q.x, screen.y - q.y) * displayScale
      const part = distance(a) < 18 ? 'start' : distance(b) < 18 ? 'end' : 'draw'
      gesture.current = { kind: 'gradient', start: p, part }
      if (part === 'draw')
        updateMask((m) => ({
          ...m,
          start: p,
          end: { x: clamp(p.x + 0.002), y: clamp(p.y + 0.002) },
        }))
    } else if (tool === 'crop') {
      onBegin()
      const c = doc.crop,
        tx = (0.018 / displayScale) * fit,
        ty = (tx * original.width) / original.height
      let corner = ''
      for (const [name, x, y] of [
        ['nw', c.x, c.y],
        ['ne', c.x + c.w, c.y],
        ['sw', c.x, c.y + c.h],
        ['se', c.x + c.w, c.y + c.h],
      ] as [string, number, number][])
        if (Math.abs(p.x - x) < tx && Math.abs(p.y - y) < ty) corner = name
      const inside = p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h
      gesture.current = {
        kind: 'crop',
        start: p,
        crop: c,
        corner: corner || (inside ? 'move' : 'draw'),
      }
    }
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    const p = eventPoint(e)
    setCursor(p)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pan') {
      setPan({ x: g.pan!.x + e.clientX - g.start.x, y: g.pan!.y + e.clientY - g.start.y })
      return
    }
    if (g.kind === 'brush')
      updateMask((m) => ({
        ...m,
        strokes: m.strokes.map((s, i) => (i === g.index ? { ...s, points: [...s.points, p] } : s)),
      }))
    if (g.kind === 'retouch')
      onChange(
        (d) => ({
          ...d,
          retouches: d.retouches.map((s, i) =>
            i === g.index ? { ...s, points: [...s.points, p] } : s,
          ),
        }),
        true,
      )
    if (g.kind === 'gradient')
      updateMask((m) => ({ ...m, [g.part === 'start' ? 'start' : 'end']: p }))
    if (g.kind === 'crop') {
      const c = g.crop!
      let next: Crop
      if (g.corner === 'move')
        next = {
          ...c,
          x: clamp(c.x + p.x - g.start.x, 0, 1 - c.w),
          y: clamp(c.y + p.y - g.start.y, 0, 1 - c.h),
        }
      else {
        const anchor =
          g.corner === 'draw'
            ? g.start
            : {
                x: g.corner!.includes('w') ? c.x + c.w : c.x,
                y: g.corner!.includes('n') ? c.y + c.h : c.y,
              }
        const signX = p.x >= anchor.x ? 1 : -1,
          signY = p.y >= anchor.y ? 1 : -1
        let w = Math.max(0.01, Math.abs(p.x - anchor.x)),
          h = Math.max(0.01, Math.abs(p.y - anchor.y))
        const maxW = signX > 0 ? 1 - anchor.x : anchor.x,
          maxH = signY > 0 ? 1 - anchor.y : anchor.y
        if (ratio) {
          const r = ratio / (photo.width / photo.height)
          h = w / r
          if (h > maxH) {
            h = maxH
            w = h * r
          }
        }
        w = Math.min(w, maxW)
        h = Math.min(h, maxH)
        if (w < 0.001 || h < 0.001) return
        next = {
          x: signX > 0 ? anchor.x : anchor.x - w,
          y: signY > 0 ? anchor.y : anchor.y - h,
          w,
          h,
        }
      }
      onChange((d) => ({ ...d, crop: next }), true)
    }
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    if (gesture.current) {
      gesture.current = null
      onCommit()
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const brushTool = ['brush', 'heal', 'clone'].includes(tool)
  const brushPoint = cursor && imageToView(cursor)
  const brushRadius =
    ((brush.size * Math.min(original.width, original.height)) / 2) *
    Math.hypot(matrix().a, matrix().b)
  const lineA = selected && imageToView(selected.start),
    lineB = selected && imageToView(selected.end)
  const retouchPins = tool === 'heal' || tool === 'clone' ? doc.retouches : []
  const sourceView = source && imageToView(source)
  const strokeWidth = 1 / displayScale
  return (
    <div ref={container} className={`canvas-space ${tool === 'hand' || space ? 'panning' : ''}`}>
      <div
        className="photo-surface"
        style={{
          width: display.width,
          height: display.height,
          transform: `translate(${pan.x}px,${pan.y}px)`,
        }}
      >
        <canvas
          ref={output}
          data-testid="photo-canvas"
          aria-label="Edited photo preview"
          style={{ width: '100%', height: '100%' }}
        />
        <svg
          data-testid="editing-surface"
          className={`editing-surface ${brushTool ? 'brush-cursor' : ''}`}
          viewBox={`0 0 ${view.width} ${view.height}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={() => {
            if (!gesture.current) setCursor(null)
          }}
          style={{
            cursor:
              tool === 'hand' || space
                ? 'grab'
                : tool === 'edit'
                  ? 'default'
                  : brushTool
                    ? 'none'
                    : 'crosshair',
          }}
        >
          {tool === 'crop' && (
            <g pointerEvents="none">
              <path
                fill="rgba(0,0,0,.62)"
                fillRule="evenodd"
                d={`M0,0 H${view.width} V${view.height} H0 Z M${doc.crop.x * view.width},${doc.crop.y * view.height} v${doc.crop.h * view.height} h${doc.crop.w * view.width} v${-doc.crop.h * view.height} Z`}
              />
              <rect
                x={doc.crop.x * view.width}
                y={doc.crop.y * view.height}
                width={doc.crop.w * view.width}
                height={doc.crop.h * view.height}
                fill="none"
                stroke="white"
                strokeWidth={strokeWidth}
              />
              {[1 / 3, 2 / 3].map((t) => (
                <g key={t} stroke="rgba(255,255,255,.55)" strokeWidth={strokeWidth * 0.7}>
                  <line
                    x1={(doc.crop.x + doc.crop.w * t) * view.width}
                    x2={(doc.crop.x + doc.crop.w * t) * view.width}
                    y1={doc.crop.y * view.height}
                    y2={(doc.crop.y + doc.crop.h) * view.height}
                  />
                  <line
                    x1={doc.crop.x * view.width}
                    x2={(doc.crop.x + doc.crop.w) * view.width}
                    y1={(doc.crop.y + doc.crop.h * t) * view.height}
                    y2={(doc.crop.y + doc.crop.h * t) * view.height}
                  />
                </g>
              ))}
              {[0, 1].flatMap((x) =>
                [0, 1].map((y) => (
                  <rect
                    key={`${x}${y}`}
                    x={(doc.crop.x + x * doc.crop.w) * view.width - 4 / displayScale}
                    y={(doc.crop.y + y * doc.crop.h) * view.height - 4 / displayScale}
                    width={8 / displayScale}
                    height={8 / displayScale}
                    fill="#e2edb4"
                  />
                )),
              )}
            </g>
          )}
          {!before && selected && lineA && lineB && ['linear', 'radial'].includes(tool) && (
            <g pointerEvents="none" stroke="#f0f4e9" strokeWidth={strokeWidth}>
              {tool === 'linear' ? (
                <line
                  x1={lineA.x}
                  y1={lineA.y}
                  x2={lineB.x}
                  y2={lineB.y}
                  strokeDasharray={`${4 / displayScale} ${4 / displayScale}`}
                />
              ) : (
                <ellipse
                  cx={selected.start.x * original.width}
                  cy={selected.start.y * original.height}
                  rx={Math.max(0.005, Math.abs(selected.end.x - selected.start.x)) * original.width}
                  ry={
                    Math.max(0.005, Math.abs(selected.end.y - selected.start.y)) * original.height
                  }
                  transform={matrix().toString()}
                  fill="none"
                />
              )}
              <circle cx={lineA.x} cy={lineA.y} r={5 / displayScale} fill="#c4d391" />
              <circle cx={lineB.x} cy={lineB.y} r={5 / displayScale} fill="#252922" />
            </g>
          )}
          {!before &&
            retouchPins.map((r) => {
              const a = imageToView(r.points[0]),
                b = imageToView(r.source)
              return (
                <g
                  key={r.id}
                  pointerEvents="none"
                  stroke="rgba(255,255,255,.7)"
                  strokeWidth={strokeWidth}
                >
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    strokeDasharray={`${3 / displayScale} ${4 / displayScale}`}
                  />
                  <circle cx={a.x} cy={a.y} r={3 / displayScale} fill="#cedfa8" />
                  <circle cx={b.x} cy={b.y} r={3 / displayScale} fill="none" />
                </g>
              )
            })}
          {sourceView && brushTool && (
            <g stroke="#e4edbb" strokeWidth={strokeWidth} pointerEvents="none">
              <circle cx={sourceView.x} cy={sourceView.y} r={6 / displayScale} fill="none" />
              <path
                d={`M${sourceView.x - 10 / displayScale},${sourceView.y} h${20 / displayScale} M${sourceView.x},${sourceView.y - 10 / displayScale} v${20 / displayScale}`}
              />
            </g>
          )}
          {brushTool && brushPoint && (
            <g pointerEvents="none" fill="none">
              <circle
                cx={brushPoint.x}
                cy={brushPoint.y}
                r={brushRadius}
                stroke="#0009"
                strokeWidth={3 * strokeWidth}
              />
              <circle
                cx={brushPoint.x}
                cy={brushPoint.y}
                r={brushRadius}
                stroke="white"
                strokeWidth={strokeWidth}
              />
              <circle
                cx={brushPoint.x}
                cy={brushPoint.y}
                r={brushRadius * (1 - brush.feather / 100)}
                stroke="#fffa"
                strokeWidth={strokeWidth * 0.7}
                strokeDasharray={`${2 / displayScale} ${3 / displayScale}`}
              />
            </g>
          )}
        </svg>
      </div>
      {before && <span className="before-label">ORIGINAL</span>}
      {zoom > 1 && (
        <button className="recenter" onClick={() => setPan({ x: 0, y: 0 })}>
          Recenter view
        </button>
      )}
    </div>
  )
}
