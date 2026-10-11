import { useState } from 'react'
import {
  ChevronDown,
  RotateCcw,
  Sun,
  Thermometer,
  Palette,
  Focus,
  SlidersHorizontal,
} from 'lucide-react'
import { BAND_COLORS, BAND_NAMES, defaults, type Adjustments } from '../engine/model'
import Slider from './Slider'

export default function AdjustmentsPanel({
  adjustments,
  onChange,
  onBegin,
  onCommit,
}: {
  adjustments: Adjustments
  onChange: (a: Adjustments) => void
  onBegin: () => void
  onCommit: () => void
}) {
  const [band, setBand] = useState(0)
  const slider = (
    key: Exclude<keyof Adjustments, 'mixer'>,
    label: string,
    min = -100,
    max = 100,
    step = 1,
    track?: string,
  ) => (
    <Slider
      key={key}
      label={label}
      value={adjustments[key]}
      min={min}
      max={max}
      step={step}
      track={track}
      reset={defaults()[key]}
      onBegin={onBegin}
      onCommit={onCommit}
      onChange={(v) => onChange({ ...adjustments, [key]: v })}
    />
  )
  const resetGroup = (keys: (keyof Adjustments)[]) => {
    onBegin()
    const next = { ...adjustments },
      def = defaults()
    for (const key of keys) Object.assign(next, { [key]: def[key] })
    onChange(next)
    onCommit()
  }
  return (
    <div className="adjustments">
      <details className="adjustment-section" open>
        <summary>
          <Sun size={16} />
          <span>Light</span>
          <button
            aria-label="Reset light"
            onClick={(e) => {
              e.preventDefault()
              resetGroup(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'])
            }}
          >
            <RotateCcw size={13} />
          </button>
          <ChevronDown size={14} />
        </summary>
        <div className="section-content">
          {slider('exposure', 'Exposure', -5, 5, 0.05)}
          {slider('contrast', 'Contrast')}
          {slider('highlights', 'Highlights')}
          {slider('shadows', 'Shadows')}
          {slider('whites', 'Whites')}
          {slider('blacks', 'Blacks')}
        </div>
      </details>
      <details className="adjustment-section" open>
        <summary>
          <Thermometer size={16} />
          <span>Color</span>
          <button
            aria-label="Reset color"
            onClick={(e) => {
              e.preventDefault()
              resetGroup(['temperature', 'tint', 'vibrance', 'saturation'])
            }}
          >
            <RotateCcw size={13} />
          </button>
          <ChevronDown size={14} />
        </summary>
        <div className="section-content">
          <div className="field-caption">
            WHITE BALANCE <span>Custom</span>
          </div>
          {slider(
            'temperature',
            'Warmth',
            -100,
            100,
            1,
            'linear-gradient(to right, #5a7ec1, #bdab66)',
          )}
          {slider('tint', 'Tint', -100, 100, 1, 'linear-gradient(to right, #779b79, #aa78a7)')}
          {slider('vibrance', 'Vibrance')}
          {slider('saturation', 'Saturation')}
        </div>
      </details>
      <details className="adjustment-section">
        <summary>
          <SlidersHorizontal size={16} />
          <span>Hue, saturation & value</span>
          <ChevronDown size={14} />
        </summary>
        <div className="section-content">
          {slider(
            'hue',
            'Hue',
            -180,
            180,
            1,
            'linear-gradient(to right, #d2656a, #c6ac61, #80ad76, #639bb8, #ab7ba6, #d2656a)',
          )}
          {slider('value', 'Value')}
          <p className="hint">Saturation is shared with the Color controls above.</p>
        </div>
      </details>
      <details className="adjustment-section">
        <summary>
          <Palette size={16} />
          <span>Color mixer</span>
          <button
            aria-label="Reset color mixer"
            onClick={(e) => {
              e.preventDefault()
              resetGroup(['mixer'])
            }}
          >
            <RotateCcw size={13} />
          </button>
          <ChevronDown size={14} />
        </summary>
        <div className="section-content">
          <div className="color-bands">
            {BAND_COLORS.map((color, i) => (
              <button
                key={color}
                title={BAND_NAMES[i]}
                aria-label={`${BAND_NAMES[i]} color range`}
                aria-pressed={band === i}
                className={band === i ? 'selected' : ''}
                style={{ background: color }}
                onClick={() => setBand(i)}
              />
            ))}
          </div>
          <div className="field-caption">{BAND_NAMES[band]} RANGE</div>
          {(['hue', 'saturation', 'luminance'] as const).map((key) => (
            <Slider
              key={key}
              label={`${BAND_NAMES[band]} ${key}`}
              value={adjustments.mixer[band][key]}
              onBegin={onBegin}
              onCommit={onCommit}
              onChange={(v) =>
                onChange({
                  ...adjustments,
                  mixer: adjustments.mixer.map((b, i) => (i === band ? { ...b, [key]: v } : b)),
                })
              }
            />
          ))}
        </div>
      </details>
      <details className="adjustment-section">
        <summary>
          <Focus size={16} />
          <span>Detail & effects</span>
          <ChevronDown size={14} />
        </summary>
        <div className="section-content">
          {slider('sharpness', 'Sharpness', 0, 100)}
          {slider('radius', 'Sharpening radius', 0.1, 5, 0.1)}
          {slider('vignette', 'Vignette', 0, 100)}
          <p className="hint">
            Sharpening can be subtle when zoomed out. Radius is measured in original pixels;
            full-resolution export preserves the detail.
          </p>
        </div>
      </details>
    </div>
  )
}
