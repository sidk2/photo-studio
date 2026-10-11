import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Brush,
  Check,
  ChevronDown,
  CircleDashed,
  Crop,
  Download,
  FolderOpen,
  Hand,
  HelpCircle,
  ImagePlus,
  Layers,
  LoaderCircle,
  Maximize,
  Minus,
  PanelLeftClose,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  clamp,
  newDocument,
  newMask,
  outputDimensions,
  type EditDocument,
  type Mask,
  type Photo,
  type Point,
} from './engine/model'
import { canvas, context } from './engine/masks'
import { applyRetouches } from './engine/retouch'
import { renderFullImage } from './engine/renderer'
import {
  canvasBlob,
  decodePhoto,
  download,
  loadDraft,
  packProject,
  saveDraft,
  unpackProject,
} from './engine/io'
import { useEditHistory } from './history'
import EditorCanvas, { type BrushSettings, type Tool } from './components/EditorCanvas'
import AdjustmentsPanel from './components/AdjustmentsPanel'
import Histogram from './components/Histogram'
import { CropPanel, MaskPanel, RetouchPanel } from './components/ToolPanels'
import Modal from './components/Modal'

const TOOL_INFO: { id: Tool; label: string; key: string; icon: typeof Brush }[] = [
  { id: 'edit', label: 'Adjust', key: 'V', icon: SlidersHorizontal },
  { id: 'crop', label: 'Crop', key: 'C', icon: Crop },
  { id: 'brush', label: 'Brush', key: 'B', icon: Brush },
  { id: 'linear', label: 'Linear gradient', key: 'L', icon: ScanLine },
  { id: 'radial', label: 'Radial gradient', key: 'R', icon: CircleDashed },
  { id: 'heal', label: 'Retouch', key: 'H', icon: WandSparkles },
  { id: 'hand', label: 'Pan', key: 'Space', icon: Hand },
]

export default function App() {
  const history = useEditHistory(),
    { doc, update, begin, commit } = history
  const [photo, setPhoto] = useState<Photo | null>(null),
    [tool, setTool] = useState<Tool>('edit'),
    [activeMask, setActiveMask] = useState<string | null>(null)
  const [brush, setBrush] = useState<BrushSettings>({
      size: 0.055,
      feather: 75,
      flow: 100,
      erase: false,
    }),
    [overlay, setOverlay] = useState(true),
    [before, setBefore] = useState(false)
  const [zoom, setZoom] = useState(1),
    [ratio, setRatio] = useState<number | null>(null),
    [source, setSource] = useState<Point | null>(null),
    [picking, setPicking] = useState(false)
  const [loading, setLoading] = useState(''),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(null),
    [saved, setSaved] = useState(''),
    [draft, setDraft] = useState<Awaited<ReturnType<typeof loadDraft>>>()
  const [dialog, setDialog] = useState<'export' | 'help' | 'reset' | null>(null),
    [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0)
  const [format, setFormat] = useState('image/jpeg'),
    [quality, setQuality] = useState(94),
    [exportSize, setExportSize] = useState('original'),
    [exportName, setExportName] = useState('photo-edited')
  const [histRevision, setHistRevision] = useState(0),
    [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null),
    rendered = useRef<HTMLCanvasElement | null>(null),
    photoRef = useRef(photo),
    dirty = useRef(false),
    projectBaseline = useRef(JSON.stringify(newDocument())),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    loadLock = useRef(false)
  photoRef.current = photo
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), error ? 10000 : 4000)
  }, [])
  const onRender = useCallback((c: HTMLCanvasElement) => {
    rendered.current = c
    setHistRevision((v) => v + 1)
  }, [])
  const onError = useCallback((message: string) => notify(message, true), [notify])
  useEffect(() => {
    loadDraft()
      .then(setDraft)
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!photo) return
    dirty.current = JSON.stringify(doc) !== projectBaseline.current
    setSaved('Saving…')
    let current = true
    const timeout = setTimeout(() => {
      saveDraft(photo, doc)
        .then(() => {
          if (current) setSaved('Saved on this device')
        })
        .catch(() => {
          if (current) {
            setSaved('Auto-save unavailable')
            notify(
              'Browser storage is unavailable or full. Download a project to keep your edits.',
              true,
            )
          }
        })
    }, 900)
    return () => {
      current = false
      clearTimeout(timeout)
    }
  }, [photo, doc])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (photo && saved !== 'Saved on this device' && dirty.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [photo, saved])
  const open = async (blob: Blob, name: string, edits?: EditDocument) => {
    if (loadLock.current) return
    if (
      photoRef.current &&
      dirty.current &&
      !window.confirm(
        'Open another photo? Download a project first if you want to keep the current edits. The automatic draft will be replaced.',
      )
    )
      return
    loadLock.current = true
    setLoading(/\.hei[cf]$/i.test(name) ? 'Decoding HEIC locally…' : 'Opening your photo…')
    try {
      let original = blob,
        filename = name,
        document = edits
      if (/\.photostudio$/i.test(name)) {
        const project = await unpackProject(blob)
        original = project.blob
        filename = project.name
        document = project.edits
      }
      const next = await decodePhoto(original, filename),
        previous = photoRef.current
      projectBaseline.current = JSON.stringify(document || newDocument())
      setPhoto(next)
      history.reset(document || newDocument())
      setTool('edit')
      setActiveMask(null)
      setSource(null)
      setPicking(false)
      setZoom(1)
      setBefore(false)
      setRatio(null)
      setDraft(undefined)
      dirty.current = false
      setExportName(filename.replace(/\.[^.]+$/, '') + '-edited')
      previous?.bitmap.close()
      notify(
        `${next.type} opened · ${next.width.toLocaleString()} × ${next.height.toLocaleString()}`,
      )
    } catch (error) {
      notify((error as Error).message || 'The photo could not be opened.', true)
    } finally {
      setLoading('')
      loadLock.current = false
    }
  }
  const saveProject = () => {
    if (!photo) return
    commit()
    download(
      packProject(photo, history.current.current),
      photo.name.replace(/\.[^.]+$/, '') + '.photostudio',
    )
    projectBaseline.current = JSON.stringify(history.current.current)
    dirty.current = false
    notify('Project saved with the original photo and every edit.')
  }
  const createMask = (type: Mask['type']) => {
    if (doc.masks.length >= 30) {
      notify('This version supports up to 30 masks per photo.', true)
      return
    }
    const mask = newMask(type, doc.masks.length)
    update((d) => ({ ...d, masks: [...d.masks, mask] }))
    setActiveMask(mask.id)
    setTool(type)
    setOverlay(true)
    setBefore(false)
  }
  const chooseTool = (next: Tool) => {
    setBefore(false)
    if (['brush', 'linear', 'radial'].includes(next)) {
      const selected = doc.masks.find((m) => m.id === activeMask)
      if (selected?.type !== next) {
        const existing = doc.masks.find((m) => m.type === next)
        if (existing) {
          setActiveMask(existing.id)
          setTool(next)
        } else createMask(next as Mask['type'])
        return
      }
    }
    setTool(next)
    setPicking(false)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || dialog || loading)
        return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        fileInput.current?.click()
        return
      }
      if (!photo) return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? history.redo() : history.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveProject()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        history.redo()
        return
      }
      if (mod || e.altKey) return
      const match = TOOL_INFO.find((t) => t.key.toLowerCase() === e.key.toLowerCase())
      if (match) {
        chooseTool(match.id)
        return
      }
      if (e.key === '\\') {
        setBefore((v) => !v)
        e.preventDefault()
      }
      if (e.key.toLowerCase() === 'o') setOverlay((v) => !v)
      if (e.key.toLowerCase() === 'e') setDialog('export')
      if (e.key === '[') setBrush((b) => ({ ...b, size: clamp(b.size * 0.85, 0.003, 0.35) }))
      if (e.key === ']') setBrush((b) => ({ ...b, size: clamp(b.size / 0.85, 0.003, 0.35) }))
      if (e.key === 'Escape') {
        setPicking(false)
        setBefore(false)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  async function exportPhoto() {
    if (!photo || exporting) return
    setExporting(true)
    setExportProgress(0)
    let base: HTMLCanvasElement | undefined,
      retouched: HTMLCanvasElement | undefined,
      result: HTMLCanvasElement | undefined
    try {
      commit()
      await new Promise((r) => setTimeout(r, 30))
      base = canvas(photo.width, photo.height)
      context(base).drawImage(photo.bitmap, 0, 0)
      retouched = applyRetouches(base, doc.retouches)
      base.width = base.height = 1
      result = await renderFullImage(retouched, doc, (v) => setExportProgress(Math.round(v * 90)))
      retouched.width = retouched.height = 1
      if (exportSize !== 'original') {
        const scale = Math.min(1, Number(exportSize) / Math.max(result.width, result.height))
        const smaller = canvas(
          Math.max(1, Math.round(result.width * scale)),
          Math.max(1, Math.round(result.height * scale)),
        )
        const ctx = context(smaller)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(result, 0, 0, smaller.width, smaller.height)
        result.width = result.height = 1
        result = smaller
      }
      if (format === 'image/jpeg') {
        const ctx = context(result)
        ctx.globalCompositeOperation = 'destination-over'
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, result.width, result.height)
      }
      setExportProgress(95)
      const blob = await canvasBlob(result, format, quality / 100)
      download(
        blob,
        `${exportName.trim() || 'photo-edited'}.${format === 'image/jpeg' ? 'jpg' : 'png'}`,
      )
      notify(
        `Exported ${result.width.toLocaleString()} × ${result.height.toLocaleString()} ${format === 'image/jpeg' ? 'JPEG' : 'PNG'}`,
      )
      setDialog(null)
    } catch (error) {
      notify((error as Error).message || 'The export failed. Try a smaller photo.', true)
    } finally {
      if (base) base.width = base.height = 1
      if (retouched) retouched.width = retouched.height = 1
      if (result) result.width = result.height = 1
      setExporting(false)
    }
  }
  const maskTool = ['brush', 'linear', 'radial'].includes(tool),
    retouchTool = tool === 'heal' || tool === 'clone'
  const dimensions = photo ? outputDimensions(photo.width, photo.height, doc) : null
  const shared = { doc, update, begin, commit }
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files[0])
          void open(e.dataTransfer.files[0], e.dataTransfer.files[0].name)
      }}
    >
      <input
        ref={fileInput}
        data-testid="file-input"
        type="file"
        hidden
        accept=".jpg,.jpeg,.png,.heic,.heif,.photostudio,image/jpeg,image/png,image/heic,image/heif"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void open(file, file.name)
          e.target.value = ''
        }}
      />
      <header className="topbar">
        <div className="brand" aria-label="Photo Studio">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            photo<span className="brand-light">studio</span>
            <span className="brand-period">.</span>
          </span>
        </div>
        <div className="topbar-actions">
          <button className="topbar-button" onClick={() => fileInput.current?.click()}>
            <FolderOpen size={16} />
            <span>Open photo</span>
          </button>
          {photo && (
            <>
              <button
                className="topbar-button"
                title="Save editable project (⌘S / Ctrl+S)"
                onClick={saveProject}
              >
                <Save size={15} />
                <span>Save project</span>
              </button>
              <button className="export-button" onClick={() => setDialog('export')}>
                <ArrowDownToLine size={16} />
                Export
                <ChevronDown size={13} />
              </button>
            </>
          )}
        </div>
      </header>
      {!photo ? (
        <main className="welcome">
          <div className="welcome-content">
            <ImagePlus size={32} strokeWidth={1.3} className="welcome-icon" />
            <h1>Open a photo</h1>
            <p>JPEG, PNG, or HEIC</p>
            <button
              className="primary-button welcome-open"
              onClick={() => fileInput.current?.click()}
            >
              <FolderOpen size={17} />
              Choose photo
            </button>
            <div className="drop-caption">or drop a photo or project here</div>
            {draft && (
              <button
                className="resume-draft"
                onClick={() => void open(draft.blob, draft.name, draft.edits)}
              >
                <RotateCcw size={17} />
                <span>
                  Continue your last session<strong>{draft.name}</strong>
                </span>
                <ArrowRight size={15} />
              </button>
            )}
            <button className="text-button welcome-help" onClick={() => setDialog('help')}>
              <HelpCircle size={14} /> Help & shortcuts
            </button>
          </div>
        </main>
      ) : (
        <main className="editor-layout">
          <nav className="tool-rail" aria-label="Editing tools">
            <div className="tools">
              {TOOL_INFO.map(({ id, label, key, icon: Icon }, i) => (
                <div key={id}>
                  {(i === 2 || i === 5 || i === 6) && <div className="tool-separator" />}
                  <button
                    className={`tool-button ${tool === id || (id === 'heal' && tool === 'clone') ? 'active' : ''}`}
                    aria-label={label}
                    aria-pressed={tool === id}
                    title={`${label} (${key})`}
                    onClick={() => chooseTool(id)}
                  >
                    <Icon size={19} />
                    <span>
                      {label === 'Linear gradient'
                        ? 'Linear'
                        : label === 'Radial gradient'
                          ? 'Radial'
                          : label}
                    </span>
                  </button>
                </div>
              ))}
            </div>
            <button
              className="help-button"
              aria-label="Help and shortcuts"
              onClick={() => setDialog('help')}
            >
              <HelpCircle size={19} />
            </button>
          </nav>
          <section className="workspace">
            <div className="workspace-header">
              <div className="photo-heading">
                <strong>{photo.name}</strong>
                <span className="file-badge">{photo.type}</span>
              </div>
              <button
                className={`compare-button ${before ? 'active' : ''}`}
                aria-label="Compare original"
                aria-pressed={before}
                onClick={() => setBefore((v) => !v)}
              >
                <PanelLeftClose size={15} />
                <span>{before ? 'Original' : 'Compare'}</span>
                <kbd>\</kbd>
              </button>
            </div>
            <EditorCanvas
              photo={photo}
              doc={doc}
              tool={tool}
              activeMask={activeMask}
              brush={brush}
              overlay={overlay}
              before={before}
              zoom={zoom}
              ratio={ratio}
              source={source}
              pickingSource={picking}
              onSource={(p) => {
                setSource(p)
                setPicking(false)
                notify('Source selected. Paint over the area to repair.')
              }}
              onChange={update}
              onBegin={begin}
              onCommit={commit}
              onRender={onRender}
              onError={onError}
            />
            <div className="canvas-toolbar">
              <div className="history-controls">
                <button
                  aria-label="Undo"
                  title="Undo (⌘Z / Ctrl+Z)"
                  disabled={!history.canUndo}
                  onClick={history.undo}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  aria-label="Redo"
                  title="Redo (⇧⌘Z / Ctrl+Shift+Z)"
                  disabled={!history.canRedo}
                  onClick={history.redo}
                >
                  <Redo2 size={16} />
                </button>
                <span className="toolbar-divider" />
                <button className="reset-button" onClick={() => setDialog('reset')}>
                  <RotateCcw size={14} />
                  Reset
                </button>
              </div>
              <div className="zoom-controls">
                <button
                  aria-label="Zoom out"
                  disabled={zoom <= 1}
                  onClick={() => setZoom((v) => Math.max(1, v / 1.5))}
                >
                  <Minus size={15} />
                </button>
                <button className="zoom-label" onClick={() => setZoom(1)} title="Fit photo">
                  {zoom === 1 ? 'Fit' : `${Number(zoom.toFixed(2))}×`}
                </button>
                <button
                  aria-label="Zoom in"
                  disabled={zoom >= 4}
                  onClick={() => setZoom((v) => Math.min(4, v * 1.5))}
                >
                  <Plus size={15} />
                </button>
                <span className="toolbar-divider" />
                <button aria-label="Fit photo" title="Fit photo" onClick={() => setZoom(1)}>
                  <Maximize size={15} />
                </button>
              </div>
            </div>
            <div className="filmstrip">
              <div className="filmstrip-photo">
                <img src={photo.url} alt="Original photo thumbnail" />
                <span>1</span>
              </div>
              <button
                className="filmstrip-add"
                title="Open another photo"
                aria-label="Open another photo"
                onClick={() => fileInput.current?.click()}
              >
                <Plus size={20} />
              </button>
              <div className="filmstrip-info">
                <strong>{photo.name}</strong>
                <span>
                  {photo.width.toLocaleString()} × {photo.height.toLocaleString()} <i />{' '}
                  {((photo.width * photo.height) / 1e6).toFixed(1)} MP <i /> {photo.type}
                </span>
              </div>
            </div>
            <footer className="statusbar">
              <span>
                {dimensions?.width} × {dimensions?.height} px
              </span>
            </footer>
          </section>
          <aside className="inspector">
            <div className="inspector-heading">
              <div>
                <h1>
                  {tool === 'crop'
                    ? 'Composition'
                    : maskTool
                      ? 'Masking'
                      : retouchTool
                        ? 'Retouch'
                        : 'Develop'}
                </h1>
              </div>
              {maskTool ? (
                <Layers size={18} />
              ) : retouchTool ? (
                <WandSparkles size={18} />
              ) : (
                <SlidersHorizontal size={18} />
              )}
            </div>
            <div className="inspector-scroll">
              <Histogram image={rendered.current} revision={histRevision} />
              {tool === 'crop' ? (
                <CropPanel
                  {...shared}
                  photo={photo}
                  ratio={ratio}
                  setRatio={setRatio}
                  done={() => setTool('edit')}
                />
              ) : maskTool ? (
                <MaskPanel
                  {...shared}
                  active={activeMask}
                  select={(m) => {
                    setActiveMask(m.id)
                    setTool(m.type)
                  }}
                  create={createMask}
                  brush={brush}
                  setBrush={setBrush}
                  overlay={overlay}
                  setOverlay={setOverlay}
                />
              ) : retouchTool ? (
                <RetouchPanel
                  {...shared}
                  brush={brush}
                  setBrush={setBrush}
                  tool={tool}
                  setTool={setTool}
                  source={source}
                  clearSource={() => setSource(null)}
                  picking={picking}
                  setPicking={setPicking}
                />
              ) : (
                <>
                  <div className="global-edit-label">
                    <span className="local-dot" /> Editing entire photo
                  </div>
                  <AdjustmentsPanel
                    adjustments={doc.adjustments}
                    onBegin={begin}
                    onCommit={commit}
                    onChange={(a) => update((d) => ({ ...d, adjustments: a }), true)}
                  />
                </>
              )}
            </div>
            <div className="inspector-bottom">
              <Check size={13} />
              <span>{saved}</span>
            </div>
          </aside>
        </main>
      )}
      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={40} />
          <h2>Open photo or project</h2>
          <p>JPEG, PNG, HEIC, or .photostudio</p>
        </div>
      )}
      {loading && (
        <div className="loading-overlay">
          <LoaderCircle className="spin" size={28} />
          <strong>{loading}</strong>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <HelpCircle size={17} /> : <Check size={17} />}
          <span>{toast.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {dialog === 'export' && photo && (
        <Modal title="Export" onClose={() => setDialog(null)} busy={exporting}>
          <label className="field-label" htmlFor="export-name">
            Filename
          </label>
          <input
            id="export-name"
            className="text-input"
            value={exportName}
            onChange={(e) => setExportName(e.target.value)}
            disabled={exporting}
          />
          <div className="export-grid">
            <div>
              <label className="field-label" htmlFor="export-format">
                Format
              </label>
              <select
                id="export-format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                disabled={exporting}
              >
                <option value="image/jpeg">JPEG</option>
                <option value="image/png">PNG</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="export-size">
                Size
              </label>
              <select
                id="export-size"
                value={exportSize}
                onChange={(e) => setExportSize(e.target.value)}
                disabled={exporting}
              >
                <option value="original">Full resolution</option>
                <option value="3840">3840 px long edge</option>
                <option value="2048">2048 px long edge</option>
                <option value="1080">1080 px long edge</option>
              </select>
            </div>
          </div>
          {format === 'image/jpeg' && (
            <div className="export-quality">
              <label htmlFor="export-quality">
                Quality <strong>{quality}%</strong>
              </label>
              <input
                id="export-quality"
                type="range"
                min={50}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                disabled={exporting}
              />
            </div>
          )}
          <div className="export-note">
            <ShieldCheck size={17} />
            <span>
              {format === 'image/jpeg'
                ? 'JPEG exports use a white background for transparent pixels.'
                : 'PNG preserves transparent pixels.'}{' '}
              Exports use standard sRGB color and omit camera and location metadata.
            </span>
          </div>
          <button
            className="primary-button full"
            disabled={exporting || !exportName.trim()}
            onClick={() => void exportPhoto()}
          >
            {exporting ? (
              <>
                <LoaderCircle className="spin" size={17} />
                Rendering photo… {exportProgress}%
              </>
            ) : (
              <>
                <Download size={17} />
                Export {format === 'image/jpeg' ? 'JPEG' : 'PNG'}
              </>
            )}
          </button>
          {exporting && <progress max={100} value={exportProgress} />}
          <p className="hint centered">To keep editable masks and adjustments, use Save project.</p>
        </Modal>
      )}
      {dialog === 'reset' && (
        <Modal title="Reset all edits?" onClose={() => setDialog(null)}>
          <p className="modal-description">
            Reset the crop, adjustments, masks, and retouch strokes. You can undo this with ⌘Z or
            Ctrl+Z.
          </p>
          <div className="modal-buttons">
            <button className="secondary-button" onClick={() => setDialog(null)}>
              Keep editing
            </button>
            <button
              className="primary-button"
              onClick={() => {
                update(() => newDocument())
                setActiveMask(null)
                setTool('edit')
                setRatio(null)
                setSource(null)
                setDialog(null)
              }}
            >
              Reset all edits
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'help' && (
        <Modal title="Help & shortcuts" onClose={() => setDialog(null)}>
          <div className="help-features">
            <p>
              <Crop size={17} />
              <span>
                <strong>Crop</strong>Crop to a preset or custom ratio, rotate, flip, and straighten.
              </span>
            </p>
            <p>
              <Brush size={17} />
              <span>
                <strong>Masks</strong>Brush, linear, and radial masks each have their own
                adjustments. Toggle the red overlay with O.
              </span>
            </p>
            <p>
              <WandSparkles size={17} />
              <span>
                <strong>Retouch</strong>Heal blends nearby texture; Clone copies from a source.
                Option / Alt-click to choose that source.
              </span>
            </p>
            <p>
              <Save size={17} />
              <span>
                <strong>Save projects</strong>The last session saves in this browser. Download a
                .photostudio project to keep the original and all edits together.
              </span>
            </p>
          </div>
          <div className="shortcut-grid">
            {[
              ['⌘ / Ctrl + Z', 'Undo'],
              ['⇧ + ⌘ / Ctrl + Z', 'Redo'],
              ['⌘ / Ctrl + S', 'Save project'],
              ['\\', 'Compare original'],
              ['Space + drag', 'Pan'],
              ['[ / ]', 'Brush size'],
              ['O', 'Mask overlay'],
              ['E', 'Export'],
            ].map(([key, label]) => (
              <div key={key}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
          <p className="hint">
            JPEG, PNG, and HEIC · up to 50 MP. Export JPEG or PNG. HEIC is decoded to standard 8-bit
            color; RAW and HDR workflows are planned for a later version.
          </p>
          <a
            className="notices-link"
            href={`${import.meta.env.BASE_URL}third-party-notices.txt`}
            target="_blank"
            rel="noreferrer"
          >
            Third-party notices
          </a>
          <button className="primary-button full" onClick={() => setDialog(null)}>
            Close
          </button>
        </Modal>
      )}
    </div>
  )
}
