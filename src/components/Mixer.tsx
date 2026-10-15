import { useDaw } from '../core/store'

export function Mixer() {
  const project = useDaw((s) => s.project)
  const run = useDaw((s) => s.run)
  return (
    <div className="mixer">
      {project.channels.map((c) => (
        <div className="strip" key={c.id}>
          <div className="strip-name" style={{ borderTopColor: c.color }} title={c.name}>
            {c.name}
          </div>
          <input
            type="range"
            className="fader"
            min={0}
            max={1}
            step={0.01}
            value={c.volume}
            aria-label={`${c.name} volume`}
            onChange={(e) => run('set_mixer', { channel: c.id, volume: Number(e.target.value) }, { group: `vol-${c.id}` })}
          />
          <span className="strip-val">{Math.round(c.volume * 100)}</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={c.pan}
            aria-label={`${c.name} pan`}
            title="Pan (double-click to center)"
            onDoubleClick={() => run('set_mixer', { channel: c.id, pan: 0 })}
            onChange={(e) => run('set_mixer', { channel: c.id, pan: Number(e.target.value) }, { group: `pan-${c.id}` })}
          />
          <div className="strip-buttons">
            <button className={c.mute ? 'on mute' : ''} onClick={() => run('set_mixer', { channel: c.id, mute: !c.mute })}>
              M
            </button>
            <button className={c.solo ? 'on solo' : ''} onClick={() => run('set_mixer', { channel: c.id, solo: !c.solo })}>
              S
            </button>
          </div>
          <button className="strip-del" onClick={() => run('remove_channel', { channel: c.id })} title={`Delete ${c.name}`}>
            ✕
          </button>
        </div>
      ))}
      <div className="strip master">
        <div className="strip-name">Master</div>
        <input
          type="range"
          className="fader"
          min={0}
          max={1}
          step={0.01}
          value={project.masterVolume}
          aria-label="Master volume"
          onChange={(e) => run('set_master_volume', { volume: Number(e.target.value) }, { group: 'master' })}
        />
        <span className="strip-val">{Math.round(project.masterVolume * 100)}</span>
      </div>
    </div>
  )
}
