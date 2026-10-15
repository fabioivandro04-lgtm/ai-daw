import { useEffect, useRef, useState } from 'react'
import { engine, useCurrentStep } from '../audio'
import { inScale, midiToName } from '../core/music'
import { useDaw } from '../core/store'
import type { Note } from '../core/types'

const ROW = 14
const COL = 22
const LOW = 24 // C1
const HIGH = 96 // C7
const KEYS_W = 52
const BLACK = new Set([1, 3, 6, 8, 10])

interface Drag {
  id: string
  mode: 'move' | 'resize'
  x0: number
  y0: number
  dStep: number
  dPitch: number
  dLen: number
}

export function PianoRoll() {
  const project = useDaw((s) => s.project)
  const run = useDaw((s) => s.run)
  const channel = useDaw((s) => s.project.channels.find((c) => c.id === s.selectedChannelId))
  const step = useCurrentStep()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [lastLength, setLastLength] = useState(2)
  const scroller = useRef<HTMLDivElement>(null)

  // Scroll to the channel's notes (or a sensible register) when switching channels.
  useEffect(() => {
    const el = scroller.current
    if (!el || !channel) return
    const pitches = channel.notes.map((n) => n.pitch)
    const center = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : channel.sound === 'bass' || channel.sound === 'sub' ? 40 : 60
    el.scrollTop = (HIGH - center) * ROW - el.clientHeight / 2
  }, [channel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!channel) return <div className="empty">Select a channel to edit its notes.</div>
  if (channel.type === 'drum')
    return <div className="empty">"{channel.name}" is a drum channel: click its steps in the channel rack. Select a synth channel to use the piano roll.</div>

  const rows = HIGH - LOW + 1
  const width = project.lengthSteps * COL

  function addAt(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.target !== e.currentTarget || !channel) return
    const r = e.currentTarget.getBoundingClientRect()
    const start = Math.floor((e.clientX - r.left) / COL)
    const pitch = HIGH - Math.floor((e.clientY - r.top) / ROW)
    if (start < 0 || start >= project.lengthSteps) return
    run('add_notes', { channel: channel.id, notes: [{ pitch, start, length: Math.min(lastLength, project.lengthSteps - start) }] })
    engine.preview(channel, pitch)
  }

  function beginDrag(e: React.PointerEvent, n: Note) {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mode = e.clientX > r.right - 7 ? 'resize' : 'move'
    setDrag({ id: n.id, mode, x0: e.clientX, y0: e.clientY, dStep: 0, dPitch: 0, dLen: 0 })
    if (channel) engine.preview(channel, n.pitch)
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag) return
    const ds = Math.round((e.clientX - drag.x0) / COL)
    const dp = -Math.round((e.clientY - drag.y0) / ROW)
    if (drag.mode === 'resize') setDrag({ ...drag, dLen: ds })
    else if (ds !== drag.dStep || dp !== drag.dPitch) {
      if (dp !== drag.dPitch && channel) {
        const n = channel.notes.find((x) => x.id === drag.id)
        if (n) engine.preview(channel, n.pitch + dp)
      }
      setDrag({ ...drag, dStep: ds, dPitch: dp })
    }
  }

  function endDrag(n: Note) {
    if (!drag || !channel) return
    const d = drag
    setDrag(null)
    if (d.mode === 'resize' && d.dLen) {
      const length = Math.max(1, n.length + d.dLen)
      run('update_note', { channel: channel.id, id: n.id, length })
      setLastLength(length)
    } else if (d.mode === 'move' && (d.dStep || d.dPitch)) {
      run('update_note', {
        channel: channel.id,
        id: n.id,
        start: Math.max(0, Math.min(project.lengthSteps - 1, n.start + d.dStep)),
        pitch: Math.max(LOW, Math.min(HIGH, n.pitch + d.dPitch)),
      })
    } else setLastLength(n.length)
  }

  return (
    <div className="piano-roll" ref={scroller}>
      <div className="pr-inner" style={{ height: rows * ROW, width: width + KEYS_W }}>
        <div className="pr-keys" style={{ width: KEYS_W }}>
          {Array.from({ length: rows }, (_, i) => {
            const pitch = HIGH - i
            return (
              <button
                key={pitch}
                className={`pr-key ${BLACK.has(pitch % 12) ? 'black' : ''}`}
                style={{ height: ROW }}
                onPointerDown={() => engine.preview(channel, pitch)}
                aria-label={midiToName(pitch)}
              >
                {pitch % 12 === 0 ? midiToName(pitch) : ''}
              </button>
            )
          })}
        </div>
        <div className="pr-grid" style={{ left: KEYS_W, width, height: rows * ROW }} onPointerDown={addAt} onContextMenu={(e) => e.preventDefault()}>
          {Array.from({ length: rows }, (_, i) => {
            const pitch = HIGH - i
            const cls = BLACK.has(pitch % 12) ? 'black' : inScale(pitch, project.keyRoot, project.scale) ? 'scale' : ''
            return <div key={pitch} className={`pr-row ${cls}`} style={{ top: i * ROW, height: ROW }} />
          })}
          {channel.notes.map((n) => {
            const d = drag?.id === n.id ? drag : null
            const start = n.start + (d?.dStep ?? 0)
            const pitch = n.pitch + (d?.dPitch ?? 0)
            const length = Math.max(1, n.length + (d?.dLen ?? 0))
            return (
              <div
                key={n.id}
                className="pr-note"
                style={{
                  left: start * COL,
                  top: (HIGH - pitch) * ROW,
                  width: length * COL - 1,
                  height: ROW - 1,
                  background: channel.color,
                  opacity: 0.55 + 0.45 * n.velocity,
                }}
                onPointerDown={(e) => beginDrag(e, n)}
                onPointerMove={moveDrag}
                onPointerUp={() => endDrag(n)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  run('remove_notes', { channel: channel.id, ids: [n.id] })
                }}
                title={`${midiToName(n.pitch)} — drag to move, drag right edge to resize, right-click to delete`}
              >
                {length >= 2 ? midiToName(pitch) : ''}
              </div>
            )
          })}
          {step !== null && <div className="playhead" style={{ left: step * COL }} />}
        </div>
      </div>
    </div>
  )
}
