import { useRef, useState } from 'react'
import { engine, usePosition } from '../audio'
import { currentPattern, describeTarget, songBars } from '../core/commands'
import { useDaw } from '../core/store'
import { FX_DEFS, STEPS_PER_BAR, type AutomationLane, type Clip, type Project } from '../core/types'
import { Menu, type MenuItem } from '../ui/Menu'
import { useUi } from '../ui/ui'

const TRACK_H = 38
const LANE_H = 64
const HEAD_W = 120

export function Playlist() {
  const project = useDaw((s) => s.project)
  const { run } = useDaw.getState()
  const pos = usePosition()
  const [barW, setBarW] = useState(64)
  const [snap, setSnap] = useState(1) // in bars
  const cur = currentPattern(project)
  const bars = Math.max(16, songBars(project) + 8)
  const tracks = Math.max(8, ...project.playlist.map((c) => c.track + 2))
  const width = bars * barW

  const barAt = (e: React.PointerEvent, el: HTMLElement) => (e.clientX - el.getBoundingClientRect().left) / barW
  const snapBar = (b: number) => Math.max(0, Math.floor(b / snap) * snap)

  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>, track: number) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    run('add_clip', { pattern: cur.id, track, bar: snapBar(barAt(e, e.currentTarget)) })
  }

  const playFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const bar = Math.floor(barAt(e, e.currentTarget))
    if (!project.songMode) run('set_song_mode', { on: true })
    engine.play(bar * STEPS_PER_BAR)
  }

  return (
    <div className="playlist">
      <aside className="picker" aria-label="Patterns">
        <div className="picker-title">Patterns</div>
        {project.patterns.map((p) => (
          <button
            key={p.id}
            className={`picker-item ${p.id === cur.id ? 'on' : ''}`}
            style={{ borderLeftColor: p.color }}
            onClick={() => run('select_pattern', { pattern: p.id })}
            onDoubleClick={() => {
              const name = prompt('Pattern name', p.name)
              if (name) run('rename_pattern', { pattern: p.id, name })
            }}
            title="Click to paint with this pattern · double-click to rename"
          >
            {p.name}
          </button>
        ))}
        <button className="picker-add" onClick={() => run('add_pattern', {})}>
          + New pattern
        </button>
      </aside>

      <div className="pl-main">
        <div className="pl-toolbar">
          <label>
            Snap
            <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} aria-label="Snap">
              <option value={1}>Bar</option>
              <option value={0.5}>1/2 bar</option>
              <option value={0.25}>Beat</option>
            </select>
          </label>
          <button onClick={() => setBarW((w) => Math.max(24, w - 16))} aria-label="Zoom out">
            −
          </button>
          <button onClick={() => setBarW((w) => Math.min(200, w + 16))} aria-label="Zoom in">
            +
          </button>
          <span className="hint">Click a track to paint "{cur.name}" · drag to move · drag the right edge to resize · right-click to delete · click the ruler to play from there</span>
        </div>

        <div className="pl-scroll">
          <div className="pl-grid" style={{ width: width + HEAD_W }}>
            <div className="pl-ruler" style={{ paddingLeft: HEAD_W }}>
              <div className="pl-ruler-bars" style={{ width }} onPointerDown={playFrom} title="Click to play the song from here">
                {Array.from({ length: bars }, (_, i) => (
                  <span key={i} style={{ left: i * barW }}>
                    {i + 1}
                  </span>
                ))}
              </div>
            </div>

            {Array.from({ length: tracks }, (_, t) => (
              <div className="pl-track" key={t} style={{ height: TRACK_H }}>
                <div className="pl-track-head" style={{ width: HEAD_W }}>
                  Track {t + 1}
                </div>
                <div className="pl-track-body" style={{ width, backgroundSize: `${barW}px 100%, ${barW * 4}px 100%` }} onPointerDown={(e) => onTrackDown(e, t)} onContextMenu={(e) => e.preventDefault()}>
                  {project.playlist
                    .filter((c) => c.track === t)
                    .map((c) => (
                      <ClipView key={c.id} clip={c} project={project} barW={barW} snap={snap} />
                    ))}
                </div>
              </div>
            ))}

            <AutomationSection project={project} barW={barW} width={width} />

            {pos?.songStep != null && <div className="pl-head" style={{ left: HEAD_W + (pos.songStep / STEPS_PER_BAR) * barW }} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function ClipView({ clip, project, barW, snap }: { clip: Clip; project: Project; barW: number; snap: number }) {
  const { run } = useDaw.getState()
  const pat = project.patterns.find((p) => p.id === clip.patternId)
  const [drag, setDrag] = useState<{ dx: number; dy: number; mode: 'move' | 'resize' } | null>(null)
  if (!pat) return null

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const mode = e.clientX > el.getBoundingClientRect().right - 8 ? 'resize' : 'move'
    const sx = e.clientX
    const sy = e.clientY
    let d = { dx: 0, dy: 0, mode } as { dx: number; dy: number; mode: 'move' | 'resize' }
    const onMove = (ev: PointerEvent) => {
      d = { mode, dx: Math.round((ev.clientX - sx) / barW / snap) * snap, dy: Math.round((ev.clientY - sy) / TRACK_H) }
      setDrag(d)
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setDrag(null)
      if (d.mode === 'move' && (d.dx || d.dy)) run('move_clip', { id: clip.id, bar: Math.max(0, clip.start + d.dx), track: Math.max(0, clip.track + d.dy) })
      if (d.mode === 'resize' && d.dx) run('move_clip', { id: clip.id, bars: Math.max(snap, clip.length + d.dx) })
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const start = clip.start + (drag?.mode === 'move' ? drag.dx : 0)
  const length = Math.max(0.25, clip.length + (drag?.mode === 'resize' ? drag.dx : 0))
  const patBars = pat.lengthSteps / STEPS_PER_BAR
  return (
    <div
      className="pl-clip"
      style={{ left: start * barW, width: length * barW - 1, top: (drag?.mode === 'move' ? drag.dy : 0) * TRACK_H + 1, background: pat.color }}
      onPointerDown={onDown}
      onDoubleClick={() => {
        run('select_pattern', { pattern: pat.id })
        useUi.getState().toggle('channelRack', true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        run('remove_clip', { id: clip.id })
      }}
      title={`${pat.name} — double-click to edit, right-click to delete`}
    >
      <span>{pat.name}</span>
      {/* Repeat markers where the pattern loops inside a longer clip. */}
      {Array.from({ length: Math.max(0, Math.ceil(length / patBars) - 1) }, (_, i) => (
        <i key={i} className="pl-loop" style={{ left: (i + 1) * patBars * barW }} />
      ))}
    </div>
  )
}

function automationTargets(p: Project): MenuItem[] {
  const items: MenuItem[] = []
  const add = (target: string) => {
    if (p.automation.some((l) => l.target === target)) return
    items.push({ label: describeTarget(p, target), onClick: () => useDaw.getState().run('set_automation', { target, points: [{ bar: 0, value: target.endsWith('pan') ? 0.5 : 0.8 }] }) })
  }
  p.mixer.forEach((ins, i) => {
    if (i > 0 && !ins.fx.length && !p.channels.some((c) => c.insert === i)) return
    add(`insert:${i}:volume`)
    add(`insert:${i}:pan`)
    ins.fx.forEach((f, s) => {
      add(`insert:${i}:fx:${s}:mix`)
      Object.keys(FX_DEFS[f.type].params).forEach((param) => add(`insert:${i}:fx:${s}:${param}`))
    })
  })
  p.channels.forEach((c) => {
    add(`channel:${c.id}:volume`)
    add(`channel:${c.id}:pan`)
  })
  return items
}

function AutomationSection({ project, barW, width }: { project: Project; barW: number; width: number }) {
  return (
    <div className="pl-auto">
      <div className="pl-auto-title" style={{ width: HEAD_W }}>
        <Menu trigger="+ Automation" items={automationTargets(project)} />
      </div>
      {project.automation.map((lane) => (
        <Lane key={lane.id} lane={lane} project={project} barW={barW} width={width} />
      ))}
    </div>
  )
}

function Lane({ lane, project, barW, width }: { lane: AutomationLane; project: Project; barW: number; width: number }) {
  const { run } = useDaw.getState()
  const svg = useRef<SVGSVGElement>(null)
  const [live, setLive] = useState<{ t: number; v: number }[] | null>(null)
  const points = live ?? lane.points
  let label: string
  try {
    label = describeTarget(project, lane.target)
  } catch {
    label = lane.target
  }
  const x = (t: number) => (t / STEPS_PER_BAR) * barW
  const y = (v: number) => (1 - v) * (LANE_H - 8) + 4
  const commit = (pts: { t: number; v: number }[]) => run('set_automation', { target: lane.target, points: pts.map((pt) => ({ bar: pt.t / STEPS_PER_BAR, value: pt.v })) })
  const fromEvent = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    const t = Math.max(0, Math.round(((e.clientX - r.left) / barW) * STEPS_PER_BAR))
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top - 4) / (LANE_H - 8)))
    return { t, v: Math.round(v * 100) / 100 }
  }

  const dragPoint = (e: React.PointerEvent, index: number) => {
    e.stopPropagation()
    if (e.button !== 0) return
    let pts = [...lane.points]
    const onMove = (ev: PointerEvent) => {
      pts = lane.points.map((p, i) => (i === index ? fromEvent(ev) : p)).sort((a, b) => a.t - b.t)
      setLive(pts)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setLive(null)
      commit(pts)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const path = points.length
    ? `M 0 ${y(points[0].v)} ` + points.map((p) => `L ${x(p.t)} ${y(p.v)}`).join(' ') + ` L ${width} ${y(points[points.length - 1].v)}`
    : ''
  return (
    <div className="pl-lane" style={{ height: LANE_H }}>
      <div className="pl-lane-head" style={{ width: HEAD_W }} title={label}>
        <span>{label}</span>
        <button onClick={() => run('remove_automation', { id: lane.id })} aria-label={`Delete automation ${label}`} title="Delete lane">
          ✕
        </button>
      </div>
      <svg
        ref={svg}
        width={width}
        height={LANE_H}
        className="pl-lane-body"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          commit([...lane.points, fromEvent(e)].sort((a, b) => a.t - b.t))
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <path d={path} className="auto-line" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(p.t)}
            cy={y(p.v)}
            r={5}
            className="auto-pt"
            onPointerDown={(e) => dragPoint(e, i)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (lane.points.length > 1) commit(lane.points.filter((_, k) => k !== i))
            }}
          >
            <title>{`Bar ${(p.t / STEPS_PER_BAR + 1).toFixed(2)} · ${Math.round(p.v * 100)}% — drag to move, right-click to delete`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}
