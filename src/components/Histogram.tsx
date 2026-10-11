import { useEffect, useRef } from 'react'

export default function Histogram({
  image,
  revision,
}: {
  image: HTMLCanvasElement | null
  revision: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!image || !ref.current) return
    const small = document.createElement('canvas')
    small.width = 256
    small.height = 128
    const ctx = small.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0, 256, 128)
    const data = ctx.getImageData(0, 0, 256, 128).data
    const bands = Array.from({ length: 3 }, () => new Float32Array(128))
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3] > 0) for (let c = 0; c < 3; c++) bands[c][data[i + c] >> 1]++
    const out = ref.current.getContext('2d')!,
      w = 560,
      h = 132
    out.clearRect(0, 0, w, h)
    out.globalCompositeOperation = 'screen'
    const max = Math.max(...bands.flatMap((b) => Array.from(b).slice(2, 126)), 1)
    bands.forEach((band, i) => {
      out.beginPath()
      out.moveTo(0, h)
      for (let j = 0; j < 128; j++)
        out.lineTo((j / 127) * w, h - Math.min(1, band[j] / max) * (h - 10))
      out.lineTo(w, h)
      out.closePath()
      out.fillStyle = ['#8e63506b', '#88a2816b', '#6b89a56b'][i]
      out.fill()
    })
  }, [image, revision])
  return (
    <div className="histogram">
      <div className="field-caption">
        HISTOGRAM
        <span>
          <i className="rgb-dot red" />
          <i className="rgb-dot green" />
          <i className="rgb-dot blue" />
        </span>
      </div>
      <canvas ref={ref} width="560" height="132" aria-label="RGB histogram" />
      <div className="histogram-axis">
        <span>Shadows</span>
        <span>Midtones</span>
        <span>Highlights</span>
      </div>
    </div>
  )
}
