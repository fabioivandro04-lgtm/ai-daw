import { useState } from 'react'
import { engine } from '../audio'
import { useDaw } from '../core/store'
import { FX_DEFS, FX_TYPES, MAX_FX_SLOTS, type FxSlot, type FxType, type Insert } from '../core/types'
import { Knob } from '../ui/Knob'
import { useAnimation, useUi } from '../ui/ui'

const db = (v: number) => (v <= 0.0001 ? '-∞' : `${(20 * Math.log10(v * v)).toFixed(1)} dB`)
const panText = (v: number) => (Math.abs(v) < 0.01 ? 'C' : `${Math.round(Math.abs(v) * 100)}${v < 0 ? 'L' : 'R'}`)

export function Mixer() {
  const mixer = useDaw((s) => s.project.mixer)
  const selected = useUi((s) => s.selectedInsert)
  return (
    <div className="mixer">
      <div className="mixer-strips" role="list" aria-label="Mixer inserts">
        {mixer.map((ins, i) => (
          <Strip key={i} index={i} ins={ins} selected={i === selected} />
        ))}
      </div>
      <InsertPanel index={selected} ins={mixer[selected]} />
    </div>
  )
}

function Strip({ index, ins, selected }: { index: number; ins: Insert; selected: boolean }) {
  const { run } = useDaw.getState()
  const routed = useDaw((s) => s.project.channels.filter((c) => c.insert === index).length)
  const set = (patch: object, group?: string) => run('set_insert', { insert: index, ...patch }, group ? { group } : undefined)
  return (
    <div className={`strip ${selected ? 'selected' : ''} ${index === 0 ? 'master' : ''} ${ins.mute ? 'muted' : ''}`} role="listitem" onPointerDown={() => useUi.getState().selectInsert(index)}>
      <div className="strip-num">{index === 0 ? 'M' : index}</div>
      <div className="strip-meter-name">
        <Meter index={index} />
        <span className={`strip-name ${routed || index === 0 || ins.fx.length ? '' : 'unused'}`} title={ins.name}>
          {ins.name}
        </span>
      </div>
      <button className={`led ${ins.mute ? '' : 'on'}`} onClick={() => set({ mute: !ins.mute })} title={ins.mute ? 'Unmute' : 'Mute'} aria-label={`Mute ${ins.name}`} aria-pressed={ins.mute} />
      <Knob value={ins.pan} min={-1} max={1} def={0} bipolar size={26} label={`${ins.name} pan`} format={panText} onChange={(v) => set({ pan: v }, `ipan-${index}`)} />
      {index > 0 ? (
        <button className={`solo ${ins.solo ? 'on' : ''}`} onClick={() => set({ solo: !ins.solo })} title="Solo" aria-label={`Solo ${ins.name}`} aria-pressed={ins.solo}>
          S
        </button>
      ) : (
        <span className="solo-spacer" />
      )}
      <input
        type="range"
        className="fader"
        min={0}
        max={1.25}
        step={0.005}
        value={ins.volume}
        aria-label={`${ins.name} volume`}
        aria-valuetext={db(ins.volume)}
        title={db(ins.volume)}
        onChange={(e) => set({ volume: Number(e.target.value) }, `ivol-${index}`)}
        onDoubleClick={() => set({ volume: index === 0 ? 0.9 : 1 })}
      />
      <div className="strip-db">{db(ins.volume)}</div>
      <div className="strip-fx-dots" aria-label={`${ins.fx.length} effects`}>
        {ins.fx.map((f) => (
          <i key={f.id} className={f.on ? 'on' : ''} title={FX_DEFS[f.type].label} />
        ))}
      </div>
    </div>
  )
}

function Meter({ index }: { index: number }) {
  const [lv, setLv] = useState(0)
  useAnimation(() => setLv((prev) => Math.max(engine.level(index), prev * 0.9)))
  return (
    <div className="meter-v" aria-hidden="true">
      <div style={{ height: `${Math.min(100, lv * 100)}%` }} className={lv > 0.98 ? 'clip' : ''} />
    </div>
  )
}

function InsertPanel({ index, ins }: { index: number; ins: Insert }) {
  const allChannels = useDaw((s) => s.project.channels)
  const channels = allChannels.filter((c) => c.insert === index)
  const { run } = useDaw.getState()
  const [open, setOpen] = useState<string | null>(null)
  const slots = Array.from({ length: MAX_FX_SLOTS }, (_, i) => ins.fx[i])
  return (
    <aside className="insert-panel" aria-label={`${ins.name} effects`}>
      <div className="insert-head">
        <input
          key={ins.name}
          defaultValue={ins.name}
          aria-label="Insert name"
          onBlur={(e) => e.target.value.trim() && e.target.value !== ins.name && run('set_insert', { insert: index, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <div className="fx-slots">
        {slots.map((fx, i) =>
          fx ? (
            <FxRow key={fx.id} index={index} slot={i} fx={fx} open={open === fx.id} onToggleOpen={() => setOpen(open === fx.id ? null : fx.id)} />
          ) : (
            <div key={i} className="fx-slot empty">
              <select
                value=""
                aria-label={`Slot ${i + 1}: add effect`}
                disabled={i > ins.fx.length}
                onChange={(e) => {
                  if (!e.target.value) return
                  run('add_fx', { insert: index, type: e.target.value as FxType })
                  setOpen(null)
                }}
              >
                <option value="">{i > ins.fx.length ? `Slot ${i + 1}` : `Slot ${i + 1} — add effect…`}</option>
                {FX_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FX_DEFS[t].label}
                  </option>
                ))}
              </select>
            </div>
          ),
        )}
      </div>
      <div className="insert-routing">
        <b>Input from:</b> {index === 0 ? 'all inserts' : channels.length ? channels.map((c) => c.name).join(', ') : 'nothing — route a channel here from the channel rack'}
      </div>
    </aside>
  )
}

function FxRow({ index, slot, fx, open, onToggleOpen }: { index: number; slot: number; fx: FxSlot; open: boolean; onToggleOpen: () => void }) {
  const { run } = useDaw.getState()
  const set = (patch: object, group?: string) => run('set_fx', { insert: index, slot, ...patch }, group ? { group } : undefined)
  const def = FX_DEFS[fx.type]
  return (
    <div className={`fx-slot ${fx.on ? '' : 'off'} ${open ? 'open' : ''}`}>
      <div className="fx-line">
        <button className="fx-expand" onClick={onToggleOpen} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${def.label} controls`}>
          {open ? '▾' : '▸'}
        </button>
        <span className="fx-name" onDoubleClick={onToggleOpen}>
          {def.label}
        </span>
        <Knob value={fx.mix} def={1} size={22} label={`${def.label} mix`} onChange={(v) => set({ mix: v }, `fxmix-${fx.id}`)} />
        <button className={`led ${fx.on ? 'on' : ''}`} onClick={() => set({ on: !fx.on })} title={fx.on ? 'Bypass' : 'Enable'} aria-label={`${def.label} on`} aria-pressed={fx.on} />
        <button className="fx-remove" onClick={() => run('remove_fx', { insert: index, slot })} title="Remove effect" aria-label={`Remove ${def.label}`}>
          ✕
        </button>
      </div>
      {open && (
        <div className="fx-params">
          {Object.entries(fx.params).map(([name, v]) => (
            <label key={name} className="fx-param">
              <Knob
                value={v}
                def={(def.params as Record<string, number>)[name]}
                size={34}
                label={`${def.label} ${name}`}
                format={name === 'mode' ? (x) => (x < 0.34 ? 'Low-pass' : x < 0.67 ? 'High-pass' : 'Band-pass') : undefined}
                onChange={(x) => set({ params: { [name]: x } }, `fxp-${fx.id}-${name}`)}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
