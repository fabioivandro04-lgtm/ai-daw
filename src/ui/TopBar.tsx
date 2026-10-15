import { useState } from 'react'
import { engine, usePosition } from '../audio'
import { currentPattern } from '../core/commands'
import { NOTE_NAMES } from '../core/music'
import { useDaw } from '../core/store'
import { DRUM_SOUNDS, SCALES, SYNTH_SOUNDS, type ScaleName } from '../core/types'
import { exportWav, loadDemo, newProject, pickSampleFiles, togglePlay } from './actions'
import { Knob } from './Knob'
import { Menu, type MenuItem } from './Menu'
import { useAnimation, useUi, type WindowId } from './ui'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function TopBar({ onSettings }: { onSettings: () => void }) {
  const project = useDaw((s) => s.project)
  const run = useDaw((s) => s.run)
  const canUndo = useDaw((s) => s.past.length > 0)
  const canRedo = useDaw((s) => s.future.length > 0)
  const windows = useUi((s) => s.windows)
  const aiOpen = useUi((s) => s.aiOpen)
  const { toggle } = useUi.getState()
  const pos = usePosition()
  const [busy, setBusy] = useState(false)
  const pat = currentPattern(project)

  const exportIt = async () => {
    setBusy(true)
    try {
      await exportWav()
    } finally {
      setBusy(false)
    }
  }

  const addChannel = (type: 'drum' | 'synth', sound: string) => run('add_channel', { name: cap(sound), type, sound })
  const renamePattern = () => {
    const name = prompt('Pattern name', pat.name)
    if (name) run('rename_pattern', { pattern: pat.id, name })
  }
  const addToPlaylist = () => {
    // Same row as this pattern's other clips, or the first empty row.
    const same = project.playlist.find((c) => c.patternId === pat.id)
    const track = same ? same.track : Math.max(-1, ...project.playlist.map((c) => c.track)) + 1
    run('add_clip', { pattern: pat.id, track, bar: Math.max(0, ...project.playlist.map((c) => c.start + c.length)) })
  }

  const patternMenu: MenuItem[] = [
    { label: 'New pattern', shortcut: 'F4', onClick: () => run('add_pattern', {}) },
    { label: 'Rename…', shortcut: 'F2', onClick: renamePattern },
    { label: 'Clone', onClick: () => run('clone_pattern', { pattern: pat.id }) },
    { label: 'Delete', disabled: project.patterns.length < 2, onClick: () => run('delete_pattern', { pattern: pat.id }) },
    { separator: true, label: '' },
    { label: 'Add to end of playlist', onClick: addToPlaylist },
    { separator: true, label: '' },
    ...[1, 2, 4, 8].map((b) => ({ label: `Length: ${b} bar${b > 1 ? 's' : ''}${pat.lengthSteps === b * 16 ? '  ✓' : ''}`, onClick: () => run('set_pattern_length', { pattern: pat.id, bars: b }) })),
  ]

  const view = (id: WindowId, label: string, key: string): MenuItem => ({ label: `${windows[id].open ? '✓ ' : ''}${label}`, shortcut: key, onClick: () => toggle(id) })

  const step = pos?.songStep ?? pos?.patternStep ?? 0
  const time = `${Math.floor(step / 16) + 1}:${String(Math.floor((step % 16) / 4) + 1).padStart(2, '0')}:${String(step % 4).padStart(2, '0')}`

  return (
    <header className="topbar">
      <nav className="menus" aria-label="Main menu">
        <Menu
          trigger="FILE"
          items={[
            { label: 'New project', onClick: newProject },
            { label: 'Load demo song', onClick: loadDemo },
            { separator: true, label: '' },
            { label: 'Import audio sample…', onClick: pickSampleFiles },
            { label: busy ? 'Rendering…' : `Export ${project.songMode ? 'song' : 'pattern'} as WAV`, disabled: busy, onClick: exportIt },
            { separator: true, label: '' },
            { label: 'Settings (AI)…', onClick: onSettings },
          ]}
        />
        <Menu
          trigger="EDIT"
          items={[
            { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: () => useDaw.getState().undo() },
            { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, onClick: () => useDaw.getState().redo() },
          ]}
        />
        <Menu
          trigger="ADD"
          items={[
            ...DRUM_SOUNDS.map((s) => ({ label: `Drum: ${cap(s)}`, onClick: () => addChannel('drum', s) })),
            { separator: true, label: '' },
            ...SYNTH_SOUNDS.map((s) => ({ label: `Synth: ${cap(s)}`, onClick: () => addChannel('synth', s) })),
            { separator: true, label: '' },
            { label: 'Audio sample…', onClick: pickSampleFiles },
          ]}
        />
        <Menu trigger="PATTERNS" items={patternMenu} />
        <Menu
          trigger="VIEW"
          items={[view('playlist', 'Playlist', 'F5'), view('channelRack', 'Channel rack', 'F6'), view('pianoRoll', 'Piano roll', 'F7'), view('mixer', 'Mixer', 'F9'), { label: `${aiOpen ? '✓ ' : ''}AI producer`, shortcut: 'F10', onClick: () => useUi.getState().setAiOpen(!useUi.getState().aiOpen) }]}
        />
        <Menu
          trigger="HELP"
          items={[
            { label: 'Space — play / stop', onClick: () => {} },
            { label: 'L — switch PAT / SONG', onClick: () => {} },
            { label: 'F5 F6 F7 F9 — windows', onClick: () => {} },
            { label: 'Right-click — delete note / clip', onClick: () => {} },
            { label: 'Double-click knob — reset', onClick: () => {} },
          ]}
        />
      </nav>

      <div className="transport-group">
        <div className="patsong" role="group" aria-label="Playback mode">
          <button className={!project.songMode ? 'on' : ''} onClick={() => run('set_song_mode', { on: false })} title="Pattern mode (L)">
            PAT
          </button>
          <button className={project.songMode ? 'on' : ''} onClick={() => run('set_song_mode', { on: true })} title="Song mode (L)">
            SONG
          </button>
        </div>
        <button className={`tbtn play ${engine.playing ? 'on' : ''}`} onClick={togglePlay} title="Play / Stop (Space)" aria-label="Play">
          {engine.playing ? '❚❚' : '▶'}
        </button>
        <button className="tbtn" onClick={() => engine.stop()} title="Stop" aria-label="Stop">
          ■
        </button>
        <label className="bpm" title="Tempo (BPM)">
          <input
            type="number"
            min={40}
            max={300}
            key={project.bpm}
            defaultValue={project.bpm}
            aria-label="Tempo in BPM"
            onBlur={(e) => e.target.value && Number(e.target.value) !== project.bpm && run('set_tempo', { bpm: Number(e.target.value) })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <div className="clock" aria-label="Position bar:beat:step">
          {time}
          <small>{project.songMode ? 'SONG' : 'PAT'}</small>
        </div>
        <div className="mini-knob" title="Swing">
          <Knob value={project.swing} def={0} label="Swing" onChange={(v) => run('set_swing', { amount: Math.round(v * 100) / 100 }, { group: 'swing' })} />
          <span>Swing</span>
        </div>
        <label className="keysel" title="Key">
          <select value={NOTE_NAMES[project.keyRoot]} onChange={(e) => run('set_key', { root: e.target.value, scale: project.scale })} aria-label="Key root">
            {NOTE_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <select value={project.scale} onChange={(e) => run('set_key', { root: NOTE_NAMES[project.keyRoot], scale: e.target.value as ScaleName })} aria-label="Scale">
            {Object.keys(SCALES).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="pattern-picker">
        <Menu trigger="▾" items={patternMenu} className="pat-opts" />
        <select value={pat.id} onChange={(e) => run('select_pattern', { pattern: e.target.value })} aria-label="Current pattern" style={{ borderLeftColor: pat.color }}>
          {project.patterns.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button className="tbtn" onClick={() => run('add_pattern', {})} title="New pattern (F4)" aria-label="New pattern">
          +
        </button>
      </div>

      <div className="win-buttons" role="group" aria-label="Windows">
        {(
          [
            ['playlist', '☰', 'Playlist (F5)'],
            ['channelRack', '▦', 'Channel rack (F6)'],
            ['pianoRoll', '♪', 'Piano roll (F7)'],
            ['mixer', '⫼', 'Mixer (F9)'],
          ] as [WindowId, string, string][]
        ).map(([id, icon, label]) => (
          <button key={id} className={`tbtn ${windows[id].open ? 'on' : ''}`} onClick={() => toggle(id)} title={label} aria-label={label} aria-pressed={windows[id].open}>
            {icon}
          </button>
        ))}
        <button className={`tbtn ai-btn ${aiOpen ? 'on' : ''}`} onClick={() => useUi.getState().setAiOpen(!useUi.getState().aiOpen)} title="AI producer (F10)">
          AI
        </button>
      </div>

      <div className="spacer" />
      <button className="tbtn" onClick={() => useDaw.getState().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        ↶
      </button>
      <button className="tbtn" onClick={() => useDaw.getState().redo()} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
        ↷
      </button>
      <MasterMeter />
    </header>
  )
}

function MasterMeter() {
  const [lv, setLv] = useState(0)
  useAnimation(() => setLv(engine.level(0)))
  return (
    <div className="master-meter" title="Master level" aria-hidden="true">
      <div style={{ width: `${Math.min(100, lv * 100)}%`, background: lv > 0.98 ? 'var(--danger)' : undefined }} />
    </div>
  )
}
