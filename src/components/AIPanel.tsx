import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio'
import { MicRecorder } from '../audio/recorder'
import { runAgent, trimHistory, type AgentSettings, type ChatMessage } from '../ai/agent'
import { detectHits, quantizeHits } from '../ai/beatbox'
import { detectNotes, quantizeNotes, SOUND_CENTER } from '../ai/pitch'
import { listen, speechSupported } from '../ai/speech'
import { currentPattern, newId } from '../core/commands'
import { useDaw } from '../core/store'
import type { DrumSound, Project } from '../core/types'
import { useAnimation } from '../ui/ui'

interface LogEntry {
  kind: 'user' | 'ai' | 'tool' | 'error'
  text: string
}

const SUGGESTIONS = [
  'Make a trap beat at 140 BPM',
  'Add a dark pad playing Am - F - C - G',
  'Make the bass line more bouncy',
  'Add an off-beat open hat and a crash on bar 1',
]

export function AIPanel({ settings, onNeedSettings }: { settings: AgentSettings; onNeedSettings: () => void }) {
  const [input, setInput] = useState('')
  const [log, setLog] = useState<LogEntry[]>([
    { kind: 'ai', text: 'Hi! Tell me what to make: type, talk (🎤), hum a melody or beatbox a groove.' },
  ])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const stopListening = useRef<(() => void) | null>(null)
  const abort = useRef<AbortController | null>(null)
  const logEnd = useRef<HTMLDivElement>(null)

  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [log])

  const add = (e: LogEntry) => setLog((l) => [...l, e])

  async function send(text: string) {
    const prompt = text.trim()
    if (!prompt || busy) return
    if (!settings.apiKey) {
      add({ kind: 'error', text: 'Add your OpenRouter API key in Settings to use the AI.' })
      onNeedSettings()
      return
    }
    setInput('')
    add({ kind: 'user', text: prompt })
    setBusy(true)
    const group = newId('ai')
    abort.current = new AbortController()
    const next: ChatMessage[] = [...history, { role: 'user', content: prompt }]
    try {
      const out = await runAgent(
        next,
        settings,
        {
          getProject: () => useDaw.getState().project,
          run: (name, args) => useDaw.getState().run(name, args, { group }),
          play: () => engine.play(),
          stop: () => engine.stop(),
          onToolCall: (name, args, _r, error) =>
            add({ kind: error ? 'error' : 'tool', text: error ? `${name}: ${error}` : describeTool(name, args) }),
        },
        abort.current.signal,
      )
      const last = out[out.length - 1]
      if (last?.content) add({ kind: 'ai', text: last.content })
      setHistory(trimHistory(out))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') add({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function toggleTalk() {
    if (listening) return stopListening.current?.()
    setListening(true)
    stopListening.current = listen(
      (t) => setInput(t),
      (t) => {
        setListening(false)
        if (t.trim()) send(t)
      },
      (msg) => {
        setListening(false)
        add({ kind: 'error', text: msg })
      },
    )
  }

  return (
    <aside className="panel ai">
      <div className="panel-title">AI producer</div>
      <div className="chat">
        {log.map((e, i) => (
          <div key={i} className={`msg ${e.kind}`}>
            {e.text}
          </div>
        ))}
        {busy && <div className="msg ai thinking">Working…</div>}
        <div ref={logEnd} />
      </div>
      {log.length <= 1 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          value={input}
          placeholder={listening ? 'Listening…' : 'e.g. "create a funky bass line in the key"'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          rows={2}
        />
        <div className="prompt-buttons">
          {speechSupported() && (
            <button type="button" className={listening ? 'rec' : ''} onClick={toggleTalk} title="Talk to the AI">
              🎤
            </button>
          )}
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
      <VoiceCapture onLog={add} />
    </aside>
  )
}

function describeTool(name: string, args: unknown): string {
  const a = args as Record<string, unknown>
  switch (name) {
    case 'add_channel':
      return `+ channel ${a.name} (${a.sound})`
    case 'set_drum_steps':
      return `♪ ${a.channel}: ${(a.steps as unknown[])?.length ?? 0} hits`
    case 'add_notes':
      return `♪ ${a.channel}: +${(a.notes as unknown[])?.length ?? 0} notes`
    case 'set_tempo':
      return `tempo ${a.bpm} BPM`
    default:
      return `${name} ${JSON.stringify(a)}`.slice(0, 80)
  }
}

type Mode = 'hum' | 'beatbox'

function VoiceCapture({ onLog }: { onLog: (e: LogEntry) => void }) {
  const project = useDaw((s) => s.project)
  const selectedId = useDaw((s) => s.selectedChannelId)
  const [mode, setMode] = useState<Mode | null>(null)
  const [snapKey, setSnapKey] = useState(true)
  const [withLoop, setWithLoop] = useState(false)
  const [level, setLevel] = useState(0)
  const rec = useRef<MicRecorder | null>(null)

  const synths = project.channels.filter((c) => c.type === 'synth')
  const [target, setTarget] = useState<string>('')
  const selectedSynth = synths.find((c) => c.id === selectedId)
  const targetId = target === 'new' || synths.some((c) => c.id === target) ? target : (selectedSynth?.id ?? synths[0]?.id ?? 'new')

  useAnimation(() => setLevel(rec.current ? rec.current.level() : 0))

  async function start(m: Mode) {
    try {
      rec.current = new MicRecorder()
      await rec.current.start()
      if (withLoop) engine.play()
      setMode(m)
    } catch (e) {
      rec.current = null
      onLog({ kind: 'error', text: `Microphone: ${(e as Error).message}` })
    }
  }

  async function finish() {
    const r = rec.current
    const m = mode
    rec.current = null
    setMode(null)
    if (!r || !m) return
    if (withLoop) engine.stop()
    try {
      const { samples, sampleRate } = await r.stop()
      const p = useDaw.getState().project
      if (m === 'hum') humToNotes(samples, sampleRate, p)
      else beatboxToDrums(samples, sampleRate, p)
    } catch (e) {
      onLog({ kind: 'error', text: (e as Error).message })
    }
  }

  function humToNotes(samples: Float32Array, sampleRate: number, p: Project) {
    const detected = detectNotes(samples, sampleRate)
    if (!detected.length) return onLog({ kind: 'error', text: 'No notes heard. Hum louder, closer to the mic, with clear "da da" attacks.' })
    const existing = p.channels.find((c) => c.id === targetId)
    const notes = quantizeNotes(detected, {
      bpm: p.bpm,
      lengthSteps: currentPattern(p).lengthSteps,
      keyRoot: p.keyRoot,
      scale: p.scale,
      snapToKey: snapKey,
      targetCenter: SOUND_CENTER[existing?.sound ?? 'lead'],
      alignFirst: !withLoop,
    })
    if (!notes.length) return onLog({ kind: 'error', text: 'Your notes fell outside the pattern. Start humming right after you press record.' })
    const { run } = useDaw.getState()
    const group = newId('hum')
    const channelId = existing?.id ?? (run('add_channel', { name: 'Voice Lead', type: 'synth', sound: 'lead' }, { group }) as { id: string }).id
    run('add_notes', { channel: channelId, notes, replace: true }, { group })
    useDaw.getState().select(channelId)
    onLog({ kind: 'ai', text: `Heard ${notes.length} notes → ${existing?.name ?? 'Voice Lead'}. Ctrl+Z to undo.` })
  }

  function beatboxToDrums(samples: Float32Array, sampleRate: number, p: Project) {
    const q = quantizeHits(detectHits(samples, sampleRate), p.bpm, currentPattern(p).lengthSteps, !withLoop)
    const total = q.kick.length + q.snare.length + q.hat.length
    if (!total) return onLog({ kind: 'error', text: 'No hits heard. Try louder "boom", "ka", "ts" sounds.' })
    const { run } = useDaw.getState()
    const group = newId('bb')
    const kit: [keyof typeof q, DrumSound[]][] = [
      ['kick', ['kick']],
      ['snare', ['snare', 'clap']],
      ['hat', ['hat', 'openhat']],
    ]
    for (const [kind, sounds] of kit) {
      const hits = q[kind]
      if (!hits.length) continue
      let ch = useDaw.getState().project.channels.find((c) => c.type === 'drum' && sounds.includes(c.sound as DrumSound))
      if (!ch) {
        const { id } = run('add_channel', { name: kind[0].toUpperCase() + kind.slice(1), type: 'drum', sound: sounds[0] }, { group }) as { id: string }
        ch = useDaw.getState().project.channels.find((c) => c.id === id)!
      }
      run('set_drum_steps', { channel: ch.id, steps: hits.map((h) => h.step), velocities: hits.map((h) => h.velocity) }, { group })
    }
    onLog({ kind: 'ai', text: `Beatbox → ${q.kick.length} kicks, ${q.snare.length} snares, ${q.hat.length} hats. Ctrl+Z to undo.` })
  }

  return (
    <div className="voice">
      <div className="voice-title">Voice → notes</div>
      <div className="voice-row">
        <label>
          Hum into
          <select value={targetId} onChange={(e) => setTarget(e.target.value)} disabled={mode !== null}>
            {synths.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="new">+ New lead</option>
          </select>
        </label>
      </div>
      <div className="voice-row">
        {mode === null ? (
          <>
            <button onClick={() => start('hum')}>🎵 Hum melody</button>
            <button onClick={() => start('beatbox')}>🥁 Beatbox drums</button>
          </>
        ) : (
          <button className="rec" onClick={finish}>
            ■ Stop & convert ({mode})
          </button>
        )}
      </div>
      <div className="level">
        <div style={{ width: `${level * 100}%` }} />
      </div>
      <label className="check">
        <input type="checkbox" checked={snapKey} onChange={(e) => setSnapKey(e.target.checked)} /> Snap hummed notes to key
      </label>
      <label className="check">
        <input type="checkbox" checked={withLoop} onChange={(e) => setWithLoop(e.target.checked)} /> Play loop while recording (keeps your timing; use headphones)
      </label>
    </div>
  )
}
