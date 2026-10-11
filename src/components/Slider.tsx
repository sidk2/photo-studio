import { useId, type CSSProperties } from 'react'

export default function Slider({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  onBegin,
  reset = 0,
  suffix = '',
  track,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  onCommit?: () => void
  onBegin?: () => void
  reset?: number
  suffix?: string
  track?: string
}) {
  const id = useId()
  return (
    <div className="slider-control">
      <div className="slider-label">
        <label
          htmlFor={id}
          onDoubleClick={() => {
            onBegin?.()
            onChange(reset)
            onCommit?.()
          }}
          title="Double-click to reset"
        >
          {label}
        </label>
        <input
          className="number-value"
          aria-label={`${label} value`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(2))}
          onFocus={onBegin}
          onBlur={onCommit}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
          }}
        />
        {suffix && <span className="value-suffix">{suffix}</span>}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={
          {
            '--position': `${((value - min) / (max - min)) * 100}%`,
            '--track': track || 'linear-gradient(to right, #3d413c, #7d8671)',
          } as CSSProperties
        }
        onPointerDown={onBegin}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onBlur={onCommit}
        onKeyDown={onBegin}
        onKeyUp={onCommit}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
