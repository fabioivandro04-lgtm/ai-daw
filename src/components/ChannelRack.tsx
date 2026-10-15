import { useState } from 'react'
import { engine, usePosition } from '../audio'
import { currentPattern, notesOf } from '../core/commands'
import { useDaw } from '../core/store'
import { DRUM_SOUNDS, INSERT_COUNT, SYNTH_SOUNDS, type Channel, type Note } from '../core/types'
import { addSampleFiles, pickSampleFiles } from '../ui/actions'
import { Knob } from '../ui/Knob'
import { Menu } from '../ui/Menu'
import { useUi } from '../ui/ui'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function ChannelRack() {
  const project = useDaw((s) => s.project)
  const selected = useDaw((s) => s.selectedChannelId)
  const { run } = useDaw.getState()
  const pos = usePosition()
  const [dropping, setDropping] = useState(false)
  const [error, setError] = useState('')
  const pat = currentPattern(project)

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const errors = await addSampleFiles(e.dataTransfer.files)
    setError(errors.join(' · '))
  }

  return (
    <div
      className={`rack ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="rack-rows">
        {project.channels.length === 0 && <p className="empty">No channels. Click + below, drop audio files here, or ask the AI: "make a trap beat".</p>}
        {project.channels.map((c, i) => (
          <RackRow
            key={c.id}
            index={i + 1}
            channel={c}
            notes={notesOf(pat, c.id)}
            lengthSteps={pat.lengthSteps}
            currentStep={pos?.patternStep ?? null}
            selected={c.id === selected}
          />
        ))}
      </div>
      {error && (
        <p className="rack-error" role="alert">
          {error}
        </p>
      )}
      <div className="rack-foot">
        <Menu
          trigger="+ Add channel"
          items={[
            ...DRUM_SOUNDS.map((s) => ({ label: `Drum: ${cap(s)}`, onClick: () => run('add_channel', { name: cap(s), type: 'drum', sound: s }) })),
            { separator: true, label: '' },
            ...SYNTH_SOUNDS.map((s) => ({ label: `Synth: ${cap(s)}`, onClick: () => run('add_channel', { name: cap(s), type: 'synth', sound: s }) })),
            { separator: true, label: '' },
            { label: 'Audio sample…', onClick: pickSampleFiles },
          ]}
        />
        <span className="hint">Drop WAV/MP3 files here to add samples · double-click a name to open the piano roll</span>
      </div>
    </div>
  )
}

function RackRow({ index, channel: c, notes, lengthSteps, currentStep, selected }: { index: number; channel: Channel; notes: Note[]; lengthSteps: number; currentStep: number | null; selected: boolean }) {
  const { run, select } = useDaw.getState()
  const hits = new Set(notes.map((n) => Math.floor(n.start)))
  const openPiano = () => {
    select(c.id)
    useUi.getState().toggle('pianoRoll', true)
  }
  return (
    <div className={`rack-row ${selected ? 'selected' : ''}`}>
      <button className={`led ${c.mute ? '' : 'on'}`} onClick={() => run('set_channel', { channel: c.id, mute: !c.mute })} title={c.mute ? 'Unmute' : 'Mute'} aria-label={`Mute ${c.name}`} aria-pressed={c.mute} />
      <Knob value={c.pan} min={-1} max={1} def={0} bipolar size={22} label={`${c.name} pan`} format={(v) => (Math.abs(v) < 0.01 ? 'C' : `${Math.round(Math.abs(v) * 100)}${v < 0 ? 'L' : 'R'}`)} onChange={(v) => run('set_channel', { channel: c.id, pan: v }, { group: `cpan-${c.id}` })} />
      <Knob value={c.volume} def={0.8} size={22} label={`${c.name} volume`} onChange={(v) => run('set_channel', { channel: c.id, volume: v }, { group: `cvol-${c.id}` })} />
      <select className="route" value={c.insert} onChange={(e) => run('set_channel', { channel: c.id, insert: Number(e.target.value) })} title="Mixer insert" aria-label={`${c.name} mixer insert`}>
        {Array.from({ length: INSERT_COUNT + 1 }, (_, i) => (
          <option key={i} value={i}>
            {i === 0 ? 'M' : i}
          </option>
        ))}
      </select>
      <button
        className="channel-name"
        style={{ borderLeftColor: c.color }}
        onClick={() => {
          select(c.id)
          engine.preview(c, notes[0]?.pitch ?? (c.type === 'synth' ? 48 : 60))
        }}
        onDoubleClick={openPiano}
        title={`${index}. ${c.name} (${c.type === 'sample' ? 'sample' : c.sound})`}
      >
        {c.type === 'sample' ? '♫ ' : ''}
        {c.name}
      </button>
      {c.type !== 'sample' && (
        <select className="sound" value={c.sound} onChange={(e) => run('set_channel_sound', { channel: c.id, sound: e.target.value })} aria-label={`${c.name} sound`}>
          {(c.type === 'drum' ? DRUM_SOUNDS : SYNTH_SOUNDS).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      {c.type === 'synth' ? (
        <button className="mini-roll" style={{ width: lengthSteps * 22 }} onClick={openPiano} title="Open in piano roll" aria-label={`Edit ${c.name} notes in the piano roll`}>
          <MiniRoll notes={notes} lengthSteps={lengthSteps} color={c.color} />
          {currentStep !== null && <span className="mini-head" style={{ left: `${(currentStep / lengthSteps) * 100}%` }} />}
        </button>
      ) : (
        <div className="steps">
          {Array.from({ length: lengthSteps }, (_, i) => (
            <button
              key={i}
              className={['step', hits.has(i) ? 'on' : '', Math.floor(i / 4) % 2 ? 'alt' : '', currentStep === i ? 'now' : ''].join(' ')}
              style={hits.has(i) ? { background: c.color } : undefined}
              onClick={() => run('toggle_step', { channel: c.id, step: i })}
              aria-label={`${c.name} step ${i + 1}`}
              aria-pressed={hits.has(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MiniRoll({ notes, lengthSteps, color }: { notes: Note[]; lengthSteps: number; color: string }) {
  if (!notes.length) return <span className="mini-empty">empty — click to draw notes</span>
  const lo = Math.min(...notes.map((n) => n.pitch))
  const hi = Math.max(...notes.map((n) => n.pitch))
  const span = Math.max(1, hi - lo)
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${lengthSteps} 100`} preserveAspectRatio="none" aria-hidden="true">
      {notes.map((n) => (
        <rect key={n.id} x={n.start} y={88 - ((n.pitch - lo) / span) * 76} width={Math.max(0.6, n.length - 0.15)} height={10} fill={color} rx={0.3} />
      ))}
    </svg>
  )
}
