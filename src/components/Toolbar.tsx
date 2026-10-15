import { useEffect, useState } from 'react'
import { engine } from '../audio'
import { renderProject } from '../audio/engine'
import { audioBufferToWav } from '../audio/wav'
import { NOTE_NAMES } from '../core/music'
import { useDaw } from '../core/store'
import { SCALES, STEPS_PER_BAR, type ScaleName } from '../core/types'

export function Toolbar({ playing, onTogglePlay, onSettings }: { playing: boolean; onTogglePlay: () => void; onSettings: () => void }) {
  const project = useDaw((s) => s.project)
  const run = useDaw((s) => s.run)
  const undo = useDaw((s) => s.undo)
  const redo = useDaw((s) => s.redo)
  const canUndo = useDaw((s) => s.past.length > 0)
  const canRedo = useDaw((s) => s.future.length > 0)
  const [exporting, setExporting] = useState(false)

  async function exportWav() {
    setExporting(true)
    try {
      const buf = await renderProject(project, 2)
      const url = URL.createObjectURL(audioBufferToWav(buf))
      const a = document.createElement('a')
      a.href = url
      a.download = `beat-${project.bpm}bpm.wav`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setExporting(false)
    }
  }

  return (
    <header className="toolbar">
      <div className="brand">
        AI<span>DAW</span>
      </div>
      <button className={`transport ${playing ? 'on' : ''}`} onClick={onTogglePlay} title="Play / Stop (Space)">
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      <label className="field">
        BPM
        <input
          type="number"
          min={40}
          max={300}
          value={project.bpm}
          onChange={(e) => e.target.value && run('set_tempo', { bpm: Number(e.target.value) }, { group: 'bpm' })}
        />
      </label>
      <label className="field">
        Swing
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={project.swing}
          onChange={(e) => run('set_swing', { amount: Number(e.target.value) }, { group: 'swing' })}
        />
      </label>
      <label className="field">
        Bars
        <select value={project.lengthSteps / STEPS_PER_BAR} onChange={(e) => run('set_pattern_length', { bars: Number(e.target.value) })}>
          {[1, 2, 4, 8].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Key
        <select value={NOTE_NAMES[project.keyRoot]} onChange={(e) => run('set_key', { root: e.target.value, scale: project.scale })}>
          {NOTE_NAMES.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <select value={project.scale} onChange={(e) => run('set_key', { root: NOTE_NAMES[project.keyRoot], scale: e.target.value as ScaleName })}>
          {Object.keys(SCALES).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="spacer" />
      <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        ↶ Undo
      </button>
      <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        ↷ Redo
      </button>
      <button onClick={exportWav} disabled={exporting}>
        {exporting ? 'Rendering…' : '⤓ Export WAV'}
      </button>
      <button onClick={onSettings}>⚙ Settings</button>
      <Meter />
    </header>
  )
}

function Meter() {
  const [, force] = useState(0)
  // Poll the analyser at animation rate only while mounted.
  useAnimation(() => force((n) => n + 1))
  let level = 0
  if (engine.analyser) {
    const buf = new Float32Array(engine.analyser.fftSize)
    engine.analyser.getFloatTimeDomainData(buf)
    for (const v of buf) level = Math.max(level, Math.abs(v))
  }
  return (
    <div className="meter" title="Master level">
      <div style={{ width: `${Math.min(100, level * 100)}%`, background: level > 0.95 ? 'var(--danger)' : undefined }} />
    </div>
  )
}

export function useAnimation(fn: () => void) {
  useEffect(() => {
    let id = 0
    const loop = () => {
      fn()
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
