import type { ReactNode } from 'react'
import { useUi, type WindowId } from './ui'

/** A floating, draggable, resizable window like FL Studio's. */
export function Window({ id, title, tools, children }: { id: WindowId; title: string; tools?: ReactNode; children: ReactNode }) {
  const w = useUi((s) => s.windows[id])
  const { move, focus, toggle } = useUi.getState()
  if (!w.open) return null

  const drag = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select')) return
    e.preventDefault()
    focus(id)
    const sx = e.clientX
    const sy = e.clientY
    const start = { ...w }
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (mode === 'move') move(id, { x: Math.max(0, start.x + dx), y: Math.max(0, start.y + dy), max: false })
      else move(id, { w: Math.max(320, start.w + dx), h: Math.max(160, start.h + dy) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const style = w.max ? { inset: 0, zIndex: w.z } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z }
  return (
    <section className={`win ${w.max ? 'max' : ''}`} style={style} onPointerDown={() => focus(id)} aria-label={title}>
      <header className="win-bar" onPointerDown={(e) => drag(e, 'move')} onDoubleClick={() => move(id, { max: !w.max })}>
        <span className="win-title">{title}</span>
        <div className="win-tools">{tools}</div>
        <button className="win-btn" onClick={() => move(id, { max: !w.max })} title={w.max ? 'Restore' : 'Maximize'} aria-label="Maximize">
          {w.max ? '❐' : '□'}
        </button>
        <button className="win-btn" onClick={() => toggle(id, false)} title="Close" aria-label="Close">
          ✕
        </button>
      </header>
      <div className="win-body">{children}</div>
      {!w.max && <div className="win-resize" onPointerDown={(e) => drag(e, 'resize')} />}
    </section>
  )
}
