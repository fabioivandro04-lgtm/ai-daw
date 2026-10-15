import { useState } from 'react'
import { engine, useCurrentStep } from '../audio'
import { useDaw } from '../core/store'
import { DRUM_SOUNDS, SYNTH_SOUNDS, type Channel } from '../core/types'

export function ChannelRack() {
  const project = useDaw((s) => s.project)
  const selected = useDaw((s) => s.selectedChannelId)
  const select = useDaw((s) => s.select)
  const run = useDaw((s) => s.run)
  const step = useCurrentStep()
  const [adding, setAdding] = useState(false)

  return (
    <section className="panel rack">
      <div className="panel-title">
        Channel rack
        <div className="add-menu">
          <button onClick={() => setAdding((a) => !a)}>+ Add channel</button>
          {adding && (
            <div className="menu" onMouseLeave={() => setAdding(false)}>
              <div className="menu-label">Drums</div>
              {DRUM_SOUNDS.map((s) => (
                <button key={s} onClick={() => (run('add_channel', { name: cap(s), type: 'drum', sound: s }), setAdding(false))}>
                  {cap(s)}
                </button>
              ))}
              <div className="menu-label">Synths</div>
              {SYNTH_SOUNDS.map((s) => (
                <button key={s} onClick={() => (run('add_channel', { name: cap(s), type: 'synth', sound: s }), setAdding(false))}>
                  {cap(s)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="rack-rows">
        {project.channels.length === 0 && <p className="empty">No channels yet. Add one, or ask the AI: "make a trap beat".</p>}
        {project.channels.map((c) => (
          <RackRow
            key={c.id}
            channel={c}
            lengthSteps={project.lengthSteps}
            currentStep={step}
            selected={c.id === selected}
            onSelect={() => select(c.id)}
            onToggle={(s) => run('toggle_step', { channel: c.id, step: s })}
            onMute={() => run('set_mixer', { channel: c.id, mute: !c.mute })}
            onSound={(sound) => run('set_channel_sound', { channel: c.id, sound })}
          />
        ))}
      </div>
    </section>
  )
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function RackRow(props: {
  channel: Channel
  lengthSteps: number
  currentStep: number | null
  selected: boolean
  onSelect: () => void
  onToggle: (step: number) => void
  onMute: () => void
  onSound: (s: string) => void
}) {
  const { channel: c, lengthSteps } = props
  const hits = new Set(c.notes.map((n) => Math.floor(n.start)))
  const sounds: readonly string[] = c.type === 'drum' ? DRUM_SOUNDS : SYNTH_SOUNDS
  return (
    <div className={`rack-row ${props.selected ? 'selected' : ''}`}>
      <button className={`led ${c.mute ? '' : 'on'}`} onClick={props.onMute} title={c.mute ? 'Unmute' : 'Mute'} aria-label={`Mute ${c.name}`} />
      <button
        className="channel-name"
        style={{ borderLeftColor: c.color }}
        onClick={() => {
          props.onSelect()
          engine.preview(c, c.notes[0]?.pitch ?? 48)
        }}
      >
        {c.name}
      </button>
      <select className="sound" value={c.sound} onChange={(e) => props.onSound(e.target.value)} aria-label={`${c.name} sound`}>
        {sounds.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <div className="steps">
        {Array.from({ length: lengthSteps }, (_, i) => {
          const cls = ['step', hits.has(i) ? 'on' : '', Math.floor(i / 4) % 2 ? 'alt' : '', props.currentStep === i ? 'now' : '']
          if (c.type === 'synth')
            return <div key={i} className={cls.join(' ') + ' mini'} style={hits.has(i) ? { background: c.color } : undefined} onClick={props.onSelect} />
          return (
            <button
              key={i}
              className={cls.join(' ')}
              style={hits.has(i) ? { background: c.color } : undefined}
              onClick={() => props.onToggle(i)}
              aria-label={`${c.name} step ${i + 1}`}
            />
          )
        })}
      </div>
    </div>
  )
}
