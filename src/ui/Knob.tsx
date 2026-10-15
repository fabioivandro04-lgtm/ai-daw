/**
 * Rotary knob: drag up/down (Shift = fine), mouse wheel, double-click to reset,
 * arrow keys when focused. Value range is [min, max].
 */
export function Knob({
  value,
  onChange,
  min = 0,
  max = 1,
  def,
  label,
  size = 28,
  bipolar = false,
  format,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  def?: number
  label: string
  size?: number
  bipolar?: boolean
  format?: (v: number) => string
}) {
  const norm = (value - min) / (max - min)
  const clampV = (v: number) => Math.min(max, Math.max(min, v))
  const angle = -135 + norm * 270
  const r = size / 2 - 3
  const arc = (from: number, to: number) => {
    const p = (a: number) => [size / 2 + r * Math.sin((a * Math.PI) / 180), size / 2 - r * Math.cos((a * Math.PI) / 180)]
    const [x1, y1] = p(from)
    const [x2, y2] = p(to)
    return `M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x2} ${y2}`
  }
  const startAngle = bipolar ? 0 : -135
  const text = format ? format(value) : `${Math.round(norm * 100)}%`

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const sy = e.clientY
    const start = value
    const onMove = (ev: PointerEvent) => onChange(clampV(start + ((sy - ev.clientY) / (ev.shiftKey ? 600 : 150)) * (max - min)))
    const el = e.currentTarget as HTMLElement
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className="knob"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={text}
      title={`${label}: ${text}`}
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => def !== undefined && onChange(def)}
      onWheel={(e) => onChange(clampV(value - Math.sign(e.deltaY) * 0.02 * (max - min)))}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
        if (d) {
          e.preventDefault()
          onChange(clampV(value + d * 0.02 * (max - min)))
        }
      }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="knob-track" />
        {Math.abs(angle - startAngle) > 0.5 && <path d={arc(Math.min(startAngle, angle), Math.max(startAngle, angle))} className="knob-arc" />}
        <circle cx={size / 2} cy={size / 2} r={r - 4} className="knob-cap" />
        <line
          x1={size / 2}
          y1={size / 2}
          x2={size / 2 + (r - 5) * Math.sin((angle * Math.PI) / 180)}
          y2={size / 2 - (r - 5) * Math.cos((angle * Math.PI) / 180)}
          className="knob-needle"
        />
      </svg>
    </div>
  )
}
