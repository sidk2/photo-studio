import {
  Brush,
  CircleDashed,
  Copy,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  MoveDown,
  MoveUp,
  RotateCcw,
  RotateCw,
  ScanLine,
  Trash2,
} from 'lucide-react'
import {
  cropForRatio,
  defaults,
  outputDimensions,
  type EditDocument,
  type Mask,
  type Photo,
  type Point,
} from '../engine/model'
import type { BrushSettings, Tool } from './EditorCanvas'
import Slider from './Slider'
import AdjustmentsPanel from './AdjustmentsPanel'

type Shared = {
  doc: EditDocument
  update: (fn: (d: EditDocument) => EditDocument, transient?: boolean) => void
  begin: () => void
  commit: () => void
}
export function CropPanel({
  doc,
  update,
  begin,
  commit,
  photo,
  ratio,
  setRatio,
  done,
}: Shared & {
  photo: Photo
  ratio: number | null
  setRatio: (n: number | null) => void
  done: () => void
}) {
  const dimensions = outputDimensions(photo.width, photo.height, doc)
  return (
    <div className="tool-panel">
      <div className="panel-title">
        <h2>Crop & compose</h2>
        <button
          title="Reset crop and rotation"
          onClick={() => {
            update((d) => ({
              ...d,
              crop: { x: 0, y: 0, w: 1, h: 1 },
              rotation: 0,
              straighten: 0,
              flipX: false,
              flipY: false,
            }))
            setRatio(null)
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <p className="hint">Drag a corner to resize. Drag inside the frame to reposition.</p>
      <label className="field-label" htmlFor="aspect-ratio">
        Aspect ratio
      </label>
      <select
        id="aspect-ratio"
        value={ratio === null ? 'free' : String(ratio)}
        onChange={(e) => {
          const r = e.target.value === 'free' ? null : Number(e.target.value)
          setRatio(r)
          update((d) => ({
            ...d,
            crop: cropForRatio(r, photo.width / photo.height, { x: 0, y: 0, w: 1, h: 1 }),
          }))
        }}
      >
        <option value="free">Freeform</option>
        <option value={photo.width / photo.height}>Original</option>
        {[
          ['1 : 1 — Square', 1],
          ['4 : 5 — Portrait', 4 / 5],
          ['3 : 2', 3 / 2],
          ['2 : 3 — Portrait', 2 / 3],
          ['4 : 3', 4 / 3],
          ['3 : 4 — Portrait', 3 / 4],
          ['16 : 9 — Widescreen', 16 / 9],
          ['9 : 16 — Story', 9 / 16],
          ['2 : 1 — Panorama', 2],
        ].map(([label, r]) => (
          <option key={label} value={r}>
            {label}
          </option>
        ))}
        {ratio !== null &&
          ![
            photo.width / photo.height,
            1,
            4 / 5,
            3 / 2,
            2 / 3,
            4 / 3,
            3 / 4,
            16 / 9,
            9 / 16,
            2,
          ].includes(ratio) && (
            <option value={ratio}>Custom — {Number(ratio.toFixed(3))} : 1</option>
          )}
      </select>
      <div className="custom-ratio">
        <label>
          Custom{' '}
          <input
            type="number"
            aria-label="Custom aspect width"
            min="1"
            max="100"
            defaultValue="3"
            id="custom-width"
          />
        </label>
        <span>:</span>
        <input
          type="number"
          aria-label="Custom aspect height"
          min="1"
          max="100"
          defaultValue="2"
          id="custom-height"
        />
        <button
          className="small-button"
          onClick={() => {
            const w = Number((document.getElementById('custom-width') as HTMLInputElement).value),
              h = Number((document.getElementById('custom-height') as HTMLInputElement).value)
            if (w > 0 && h > 0 && w / h > 0.05 && w / h < 20) {
              setRatio(w / h)
              update((d) => ({
                ...d,
                crop: cropForRatio(w / h, photo.width / photo.height, { x: 0, y: 0, w: 1, h: 1 }),
              }))
            }
          }}
        >
          Apply
        </button>
      </div>
      {ratio !== null && <p className="hint">Locked to {ratio.toFixed(3)} : 1 before rotation.</p>}
      <div className="panel-divider" />
      <div className="field-caption">ROTATE & FLIP</div>
      <div className="button-grid four">
        <button
          title="Rotate left"
          aria-label="Rotate left"
          onClick={() => update((d) => ({ ...d, rotation: (d.rotation + 270) % 360 }))}
        >
          <RotateCcw size={18} />
        </button>
        <button
          title="Rotate right"
          aria-label="Rotate right"
          onClick={() => update((d) => ({ ...d, rotation: (d.rotation + 90) % 360 }))}
        >
          <RotateCw size={18} />
        </button>
        <button
          title="Flip horizontally"
          aria-label="Flip horizontally"
          className={doc.flipX ? 'active' : ''}
          onClick={() => update((d) => ({ ...d, flipX: !d.flipX }))}
        >
          <FlipHorizontal2 size={18} />
        </button>
        <button
          title="Flip vertically"
          aria-label="Flip vertically"
          className={doc.flipY ? 'active' : ''}
          onClick={() => update((d) => ({ ...d, flipY: !d.flipY }))}
        >
          <FlipVertical2 size={18} />
        </button>
      </div>
      <Slider
        label="Straighten"
        value={doc.straighten}
        min={-15}
        max={15}
        step={0.1}
        onBegin={begin}
        onCommit={commit}
        onChange={(v) => update((d) => ({ ...d, straighten: v }), true)}
      />
      <p className="hint">
        Straightening fills the frame automatically. Apply the crop to see rotation and
        straightening.
      </p>
      <div className="dimensions-card">
        <span>Output dimensions</span>
        <strong>
          {dimensions.width.toLocaleString()} × {dimensions.height.toLocaleString()}
        </strong>
      </div>
      <button className="primary-button full" onClick={done}>
        Apply crop
      </button>
    </div>
  )
}
export function BrushControls({
  brush,
  setBrush,
  retouch = false,
}: {
  brush: BrushSettings
  setBrush: (b: BrushSettings) => void
  retouch?: boolean
}) {
  return (
    <div className="brush-controls">
      {!retouch && (
        <div className="segmented">
          <button
            className={!brush.erase ? 'selected' : ''}
            onClick={() => setBrush({ ...brush, erase: false })}
          >
            Paint
          </button>
          <button
            className={brush.erase ? 'selected' : ''}
            onClick={() => setBrush({ ...brush, erase: true })}
          >
            Erase
          </button>
        </div>
      )}
      <Slider
        label="Brush size"
        value={brush.size * 100}
        min={0.3}
        max={35}
        step={0.1}
        onChange={(v) => setBrush({ ...brush, size: v / 100 })}
      />
      <Slider
        label="Feather"
        value={brush.feather}
        min={0}
        max={100}
        onChange={(v) => setBrush({ ...brush, feather: v })}
      />
      <Slider
        label={retouch ? 'Opacity' : 'Flow'}
        value={brush.flow}
        min={1}
        max={100}
        onChange={(v) => setBrush({ ...brush, flow: v })}
      />
    </div>
  )
}
export function MaskPanel({
  doc,
  update,
  begin,
  commit,
  active,
  select,
  create,
  brush,
  setBrush,
  overlay,
  setOverlay,
}: Shared & {
  active: string | null
  select: (m: Mask) => void
  create: (type: Mask['type']) => void
  brush: BrushSettings
  setBrush: (b: BrushSettings) => void
  overlay: boolean
  setOverlay: (v: boolean) => void
}) {
  const mask = doc.masks.find((m) => m.id === active)
  const updateMask = (fn: (m: Mask) => Mask, transient = false) =>
    update((d) => ({ ...d, masks: d.masks.map((m) => (m.id === active ? fn(m) : m)) }), transient)
  return (
    <>
      <div className="tool-panel">
        <div className="panel-title">
          <h2>Selective edits</h2>
          <span className="count-badge">{doc.masks.length}</span>
        </div>
        <div className="mask-create">
          <button onClick={() => create('brush')}>
            <Brush size={17} />
            <span>Brush</span>
          </button>
          <button onClick={() => create('linear')}>
            <ScanLine size={17} />
            <span>Linear</span>
          </button>
          <button onClick={() => create('radial')}>
            <CircleDashed size={17} />
            <span>Radial</span>
          </button>
        </div>
        <div className="mask-list">
          {doc.masks.map((m) => (
            <div key={m.id} className={`mask-row ${m.id === active ? 'selected' : ''}`}>
              <button className="mask-select" onClick={() => select(m)}>
                {m.type === 'brush' ? (
                  <Brush size={15} />
                ) : m.type === 'linear' ? (
                  <ScanLine size={15} />
                ) : (
                  <CircleDashed size={15} />
                )}
                <span>{m.name}</span>
              </button>
              <button
                aria-label={`Toggle ${m.name}`}
                onClick={() =>
                  update((d) => ({
                    ...d,
                    masks: d.masks.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x)),
                  }))
                }
              >
                {m.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          ))}
        </div>
        {mask && (
          <>
            <div className="mask-actions">
              <input
                className="mask-name"
                aria-label="Mask name"
                value={mask.name}
                maxLength={100}
                onFocus={begin}
                onBlur={commit}
                onChange={(e) => updateMask((m) => ({ ...m, name: e.target.value }), true)}
              />
              <button
                title="Duplicate mask"
                aria-label="Duplicate mask"
                disabled={doc.masks.length >= 30}
                onClick={() => {
                  const m = {
                    ...structuredClone(mask),
                    id: crypto.randomUUID(),
                    name: `${mask.name} copy`.slice(0, 100),
                  }
                  update((d) => ({ ...d, masks: [...d.masks, m] }))
                  select(m)
                }}
              >
                <Copy size={14} />
              </button>
              <button
                title="Delete mask"
                aria-label="Delete mask"
                onClick={() =>
                  update((d) => ({ ...d, masks: d.masks.filter((m) => m.id !== active) }))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="mask-options">
              <label>
                <input
                  type="checkbox"
                  checked={overlay}
                  onChange={(e) => setOverlay(e.target.checked)}
                />{' '}
                Show overlay <kbd>O</kbd>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mask.inverted}
                  onChange={() => updateMask((m) => ({ ...m, inverted: !m.inverted }))}
                />{' '}
                Invert
              </label>
            </div>
            <Slider
              label="Mask amount"
              value={mask.opacity}
              min={0}
              max={100}
              onBegin={begin}
              onCommit={commit}
              onChange={(v) => updateMask((m) => ({ ...m, opacity: v }), true)}
            />
            {mask.type === 'brush' ? (
              <BrushControls brush={brush} setBrush={setBrush} />
            ) : (
              <>
                <p className="hint">
                  {mask.type === 'linear'
                    ? 'Drag across the image to place the gradient. Move either pin to change its direction and falloff.'
                    : 'Drag from the center outward to draw an oval. Move its pins to adjust the center and size.'}
                </p>
                {mask.type === 'radial' && (
                  <Slider
                    label="Gradient feather"
                    value={mask.feather}
                    min={0}
                    max={100}
                    onBegin={begin}
                    onCommit={commit}
                    onChange={(v) => updateMask((m) => ({ ...m, feather: v }), true)}
                  />
                )}
              </>
            )}
            <div className="mask-footer-actions">
              <button
                className="text-button"
                disabled={doc.masks[0]?.id === active}
                onClick={() =>
                  update((d) => {
                    const masks = [...d.masks],
                      i = masks.findIndex((m) => m.id === active)
                    ;[masks[i - 1], masks[i]] = [masks[i], masks[i - 1]]
                    return { ...d, masks }
                  })
                }
              >
                <MoveUp size={12} />
                Earlier
              </button>
              <button
                className="text-button"
                disabled={doc.masks.at(-1)?.id === active}
                onClick={() =>
                  update((d) => {
                    const masks = [...d.masks],
                      i = masks.findIndex((m) => m.id === active)
                    ;[masks[i + 1], masks[i]] = [masks[i], masks[i + 1]]
                    return { ...d, masks }
                  })
                }
              >
                <MoveDown size={12} />
                Later
              </button>
              <button
                className="text-button"
                onClick={() => updateMask((m) => ({ ...m, adjustments: defaults() }))}
              >
                Reset adjustments
              </button>
            </div>
          </>
        )}
        {!mask && (
          <p className="hint">Create or select a mask to adjust a particular part of your photo.</p>
        )}
      </div>
      {mask && (
        <>
          <div className="local-label">ADJUSTMENTS · {mask.name}</div>
          <AdjustmentsPanel
            adjustments={mask.adjustments}
            onBegin={begin}
            onCommit={commit}
            onChange={(a) => updateMask((m) => ({ ...m, adjustments: a }), true)}
          />
        </>
      )}
    </>
  )
}
export function RetouchPanel({
  doc,
  update,
  brush,
  setBrush,
  tool,
  setTool,
  source,
  clearSource,
  picking,
  setPicking,
}: Shared & {
  brush: BrushSettings
  setBrush: (b: BrushSettings) => void
  tool: Tool
  setTool: (t: Tool) => void
  source: Point | null
  clearSource: () => void
  picking: boolean
  setPicking: (v: boolean) => void
}) {
  return (
    <div className="tool-panel">
      <div className="panel-title">
        <h2>Retouch</h2>
        <span className="count-badge">{doc.retouches.length}</span>
      </div>
      <div className="segmented">
        <button className={tool === 'heal' ? 'selected' : ''} onClick={() => setTool('heal')}>
          Heal
        </button>
        <button className={tool === 'clone' ? 'selected' : ''} onClick={() => setTool('clone')}>
          Clone
        </button>
      </div>
      <p className="hint">
        {tool === 'heal'
          ? 'Paint over a blemish. Nearby texture is sampled and blended with the surrounding color.'
          : 'Choose a source, then paint to copy its texture. Useful for precise repairs and repeated patterns.'}
      </p>
      <BrushControls brush={brush} setBrush={setBrush} retouch />
      <div className="panel-divider" />
      <div className="field-caption">
        SAMPLE SOURCE{' '}
        <span>{source ? 'Manual' : tool === 'heal' ? 'Automatic' : 'Not selected'}</span>
      </div>
      <button
        className={`secondary-button full ${picking ? 'active' : ''}`}
        onClick={() => setPicking(!picking)}
      >
        {picking ? 'Click a clean area in the photo…' : 'Choose source in photo'}
      </button>
      {source && (
        <button className="text-button full" onClick={clearSource}>
          {tool === 'heal' ? 'Use automatic source' : 'Clear source'}
        </button>
      )}
      <p className="hint">
        Hold <kbd>Alt / Option</kbd> and click to sample. Use <kbd>[</kbd> <kbd>]</kbd> to resize
        the brush.
      </p>
      {!!doc.retouches.length && (
        <>
          <div className="panel-divider" />
          <div className="field-caption">RETOUCH HISTORY</div>
          <div className="retouch-list">
            {doc.retouches.map((r, i) => (
              <div className="retouch-row" key={r.id}>
                <span>
                  <i />
                  {r.mode === 'heal' ? 'Heal' : 'Clone'} {i + 1}
                </span>
                <button
                  aria-label={`Delete retouch ${i + 1}`}
                  onClick={() =>
                    update((d) => ({ ...d, retouches: d.retouches.filter((x) => x.id !== r.id) }))
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
