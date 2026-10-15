import { NOTE_NAMES, parseKeyRoot, parsePitch, midiToName } from './music'
import {
  DRUM_SOUNDS,
  FX_DEFS,
  FX_TYPES,
  INSERT_COUNT,
  MAX_FX_SLOTS,
  SCALES,
  STEPS_PER_BAR,
  SYNTH_SOUNDS,
  type AutomationLane,
  type Channel,
  type Clip,
  type FxSlot,
  type FxType,
  type Insert,
  type Note,
  type Pattern,
  type Project,
  type ScaleName,
} from './types'

/**
 * Every change to a project goes through a command. The UI, the AI agent and
 * the voice tools all call the same commands, so everything is undoable and
 * anything a user can do, the AI can do too.
 */
export interface CommandResult {
  project: Project
  result: unknown
}

export interface Command {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
  apply: (project: Project, args: any) => CommandResult
}

export const COLORS = ['#ff8a3d', '#ffd23d', '#5ee0a0', '#4cc3ff', '#a98bff', '#ff6fb1', '#9be15d', '#ff5f5f']

let idCounter = 0
export function newId(prefix: string): string {
  idCounter += 1
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function num(v: unknown, name: string): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`"${name}" must be a number`)
  return n
}

// ---------- lookups ----------

export function findChannel(project: Project, ref: string): Channel {
  const r = String(ref).trim().toLowerCase()
  const ch = project.channels.find((c) => c.id === ref) ?? project.channels.find((c) => c.name.toLowerCase() === r)
  if (!ch) {
    const names = project.channels.map((c) => `"${c.name}"`).join(', ') || 'none'
    throw new Error(`No channel "${ref}". Existing channels: ${names}`)
  }
  return ch
}

export function findPattern(project: Project, ref?: string): Pattern {
  if (ref === undefined || ref === null || ref === '') {
    return project.patterns.find((p) => p.id === project.currentPatternId) ?? project.patterns[0]
  }
  const r = String(ref).trim().toLowerCase()
  const pat = project.patterns.find((p) => p.id === ref) ?? project.patterns.find((p) => p.name.toLowerCase() === r)
  if (!pat) {
    const names = project.patterns.map((p) => `"${p.name}"`).join(', ')
    throw new Error(`No pattern "${ref}". Existing patterns: ${names}`)
  }
  return pat
}

export function currentPattern(project: Project): Pattern {
  return findPattern(project)
}

/** Accepts 0..16, "Master", "Insert 3", "3" or a custom insert name. */
export function findInsert(project: Project, ref: unknown): number {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) {
    const n = Math.round(Number(ref))
    if (n < 0 || n >= project.mixer.length) throw new Error(`Insert ${n} does not exist (0 = Master, 1-${INSERT_COUNT})`)
    return n
  }
  const r = String(ref).trim().toLowerCase()
  if (r === 'master') return 0
  const m = /^insert\s*(\d+)$/.exec(r)
  if (m) return findInsert(project, Number(m[1]))
  const i = project.mixer.findIndex((ins) => ins.name.toLowerCase() === r)
  if (i < 0) throw new Error(`No mixer insert "${ref}". Use a number 0-${INSERT_COUNT} (0 = Master).`)
  return i
}

export function notesOf(pattern: Pattern, channelId: string): Note[] {
  return pattern.notes[channelId] ?? []
}

// ---------- immutable updates ----------

function updateChannel(p: Project, id: string, fn: (c: Channel) => Channel): Project {
  return { ...p, channels: p.channels.map((c) => (c.id === id ? fn(c) : c)) }
}

function updatePattern(p: Project, id: string, fn: (pat: Pattern) => Pattern): Project {
  return { ...p, patterns: p.patterns.map((pat) => (pat.id === id ? fn(pat) : pat)) }
}

function setNotes(p: Project, patternId: string, channelId: string, notes: Note[]): Project {
  return updatePattern(p, patternId, (pat) => ({ ...pat, notes: { ...pat.notes, [channelId]: sortNotes(notes) } }))
}

function updateInsert(p: Project, n: number, fn: (ins: Insert) => Insert): Project {
  return { ...p, mixer: p.mixer.map((ins, i) => (i === n ? fn(ins) : ins)) }
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

interface NoteInput {
  pitch?: string | number
  start: number
  length?: number
  velocity?: number
}

function buildNotes(pattern: Pattern, input: NoteInput[]): Note[] {
  if (!Array.isArray(input)) throw new Error('"notes" must be an array')
  return input.map((n) => {
    if (!n || typeof n !== 'object') throw new Error('Each note must be an object')
    const start = num(n.start, 'start')
    if (start < 0 || start >= pattern.lengthSteps)
      throw new Error(`Note start ${start} is outside pattern "${pattern.name}" (0-${pattern.lengthSteps - 1})`)
    const pitch = n.pitch === undefined ? 60 : parsePitch(n.pitch)
    if (pitch < 0 || pitch > 127) throw new Error(`Pitch ${pitch} out of range`)
    return {
      id: newId('n'),
      pitch,
      start,
      length: Math.max(0.25, n.length === undefined ? 1 : num(n.length, 'length')),
      velocity: clamp(n.velocity === undefined ? 0.8 : num(n.velocity, 'velocity'), 0, 1),
    }
  })
}

export function newInsert(index: number): Insert {
  return { name: index === 0 ? 'Master' : `Insert ${index}`, volume: index === 0 ? 0.9 : 1, pan: 0, mute: false, solo: false, fx: [] }
}

export function newFx(type: FxType): FxSlot {
  return { id: newId('fx'), type, on: true, mix: type === 'reverb' || type === 'delay' ? 0.3 : 1, params: { ...FX_DEFS[type].params } }
}

/** Song length in bars: end of the last clip (at least 1). */
export function songBars(p: Project): number {
  return Math.max(1, ...p.playlist.map((c) => c.start + c.length))
}

/** Checks an automation target path and returns a readable label. */
export function describeTarget(p: Project, target: string): string {
  const parts = target.split(':')
  if (parts[0] === 'insert') {
    const n = findInsert(p, parts[1])
    const ins = p.mixer[n]
    if (parts[2] === 'volume' || parts[2] === 'pan') return `${ins.name} ${parts[2]}`
    if (parts[2] === 'fx') {
      const slot = ins.fx[Number(parts[3])]
      if (!slot) throw new Error(`${ins.name} has no FX in slot ${parts[3]}`)
      const param = parts[4]
      if (param !== 'mix' && !(param in slot.params)) throw new Error(`${FX_DEFS[slot.type].label} has no "${param}"`)
      return `${ins.name} ${FX_DEFS[slot.type].label} ${param}`
    }
  }
  if (parts[0] === 'channel' && (parts[2] === 'volume' || parts[2] === 'pan')) {
    return `${findChannel(p, parts[1]).name} ${parts[2]}`
  }
  throw new Error(`Invalid automation target "${target}"`)
}

// ---------- AI summary ----------

export function summarizeProject(p: Project) {
  const nameOf = (id: string) => p.channels.find((c) => c.id === id)?.name ?? id
  return {
    bpm: p.bpm,
    swing: p.swing,
    key: `${NOTE_NAMES[p.keyRoot]} ${p.scale}`,
    songMode: p.songMode,
    currentPattern: currentPattern(p).name,
    channels: p.channels.map((c) => ({
      name: c.name,
      type: c.type,
      sound: c.sound,
      insert: c.insert,
      volume: Math.round(c.volume * 100) / 100,
      pan: c.pan,
      mute: c.mute,
    })),
    patterns: p.patterns.map((pat) => ({
      name: pat.name,
      bars: pat.lengthSteps / STEPS_PER_BAR,
      notes: Object.fromEntries(
        Object.entries(pat.notes)
          .filter(([, ns]) => ns.length)
          .map(([cid, ns]) => {
            const ch = p.channels.find((c) => c.id === cid)
            return [
              nameOf(cid),
              ch?.type === 'drum' ? { steps: ns.map((n) => n.start) } : ns.map((n) => [midiToName(n.pitch), n.start, n.length]),
            ]
          }),
      ),
    })),
    playlist: p.playlist.map((c) => ({ id: c.id, pattern: p.patterns.find((pat) => pat.id === c.patternId)?.name, track: c.track, bar: c.start, bars: c.length })),
    mixer: p.mixer
      .map((ins, i) => ({ insert: i, ...ins, fx: ins.fx.map((f, slot) => ({ slot, type: f.type, on: f.on, mix: f.mix, params: f.params })) }))
      .filter((ins) => ins.insert === 0 || ins.fx.length || ins.volume !== 1 || ins.pan || ins.mute || ins.solo || p.channels.some((c) => c.insert === ins.insert)),
    automation: p.automation.map((a) => ({ id: a.id, target: a.target, points: a.points.map((pt) => [pt.t / STEPS_PER_BAR, pt.v]) })),
  }
}

// ---------- commands ----------

const channelParam = { type: 'string', description: 'Channel name or id' }
const patternParam = { type: 'string', description: 'Pattern name or id (default: the current pattern)' }
const insertParam = { type: ['integer', 'string'], description: 'Mixer insert: 0 = Master, 1-16, or its name' }
const fxParamsDoc = Object.entries(FX_DEFS)
  .map(([t, d]) => `${t}: ${Object.keys(d.params).join(', ')}`)
  .join('; ')

export const COMMANDS: Command[] = [
  // --- global ---
  {
    name: 'set_tempo',
    description: 'Set the project tempo in BPM (40-300).',
    parameters: { type: 'object', properties: { bpm: { type: 'number' } }, required: ['bpm'] },
    apply: (p, a) => {
      const bpm = clamp(Math.round(num(a.bpm, 'bpm')), 40, 300)
      return { project: { ...p, bpm }, result: { bpm } }
    },
  },
  {
    name: 'set_swing',
    description: 'Set the swing amount from 0 (straight) to 1 (heavy shuffle).',
    parameters: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
    apply: (p, a) => {
      const swing = clamp(num(a.amount, 'amount'), 0, 1)
      return { project: { ...p, swing }, result: { swing } }
    },
  },
  {
    name: 'set_key',
    description: 'Set the musical key used for scale snapping and suggestions.',
    parameters: {
      type: 'object',
      properties: { root: { type: 'string', description: 'Root note, e.g. "C", "F#", "Bb"' }, scale: { type: 'string', enum: Object.keys(SCALES) } },
      required: ['root', 'scale'],
    },
    apply: (p, a) => {
      if (!(a.scale in SCALES)) throw new Error(`Unknown scale "${a.scale}"`)
      const keyRoot = parseKeyRoot(a.root)
      return { project: { ...p, keyRoot, scale: a.scale as ScaleName }, result: { root: a.root, scale: a.scale } }
    },
  },
  {
    name: 'set_song_mode',
    description: 'true = play the whole playlist arrangement (SONG). false = loop the current pattern (PAT).',
    parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
    apply: (p, a) => ({ project: { ...p, songMode: Boolean(a.on) }, result: { songMode: Boolean(a.on) } }),
  },

  // --- channels ---
  {
    name: 'add_channel',
    description: 'Add an instrument channel to the channel rack. Drum channels play one drum sound; synth channels play melodic notes. It is routed to its own free mixer insert.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['drum', 'synth'] },
        sound: { type: 'string', enum: [...DRUM_SOUNDS, ...SYNTH_SOUNDS], description: `Drum sounds: ${DRUM_SOUNDS.join(', ')}. Synth sounds: ${SYNTH_SOUNDS.join(', ')}.` },
      },
      required: ['name', 'type', 'sound'],
    },
    apply: (p, a) => {
      const type = a.type === 'drum' ? 'drum' : 'synth'
      const valid: readonly string[] = type === 'drum' ? DRUM_SOUNDS : SYNTH_SOUNDS
      if (!valid.includes(a.sound)) throw new Error(`"${a.sound}" is not a ${type} sound. Use one of: ${valid.join(', ')}`)
      return addChannel(p, { name: String(a.name || a.sound), type, sound: a.sound })
    },
  },
  {
    name: 'add_sample_channel',
    description: 'Add a channel that plays an imported audio sample (used by the UI after a file import).',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, sampleId: { type: 'string' } },
      required: ['name', 'sampleId'],
    },
    apply: (p, a) => addChannel(p, { name: String(a.name), type: 'sample', sound: String(a.name), sampleId: String(a.sampleId) }),
  },
  {
    name: 'remove_channel',
    description: 'Delete a channel and its notes in every pattern.',
    parameters: { type: 'object', properties: { channel: channelParam }, required: ['channel'] },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      return {
        project: {
          ...p,
          channels: p.channels.filter((c) => c.id !== ch.id),
          patterns: p.patterns.map((pat) => {
            const { [ch.id]: _gone, ...notes } = pat.notes
            return { ...pat, notes }
          }),
          automation: p.automation.filter((l) => !l.target.startsWith(`channel:${ch.id}:`)),
        },
        result: { removed: ch.name },
      }
    },
  },
  {
    name: 'rename_channel',
    description: 'Rename a channel.',
    parameters: { type: 'object', properties: { channel: channelParam, name: { type: 'string' } }, required: ['channel', 'name'] },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const name = String(a.name).trim()
      if (!name) throw new Error('Name cannot be empty')
      return { project: updateChannel(p, ch.id, (c) => ({ ...c, name })), result: { name } }
    },
  },
  {
    name: 'set_channel_sound',
    description: 'Change the sound a drum or synth channel plays (must match the channel type).',
    parameters: { type: 'object', properties: { channel: channelParam, sound: { type: 'string', enum: [...DRUM_SOUNDS, ...SYNTH_SOUNDS] } }, required: ['channel', 'sound'] },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      if (ch.type === 'sample') throw new Error(`${ch.name} plays an audio sample; its sound cannot be changed`)
      const valid: readonly string[] = ch.type === 'drum' ? DRUM_SOUNDS : SYNTH_SOUNDS
      if (!valid.includes(a.sound)) throw new Error(`"${a.sound}" is not a ${ch.type} sound. Use one of: ${valid.join(', ')}`)
      return { project: updateChannel(p, ch.id, (c) => ({ ...c, sound: a.sound })), result: { sound: a.sound } }
    },
  },
  {
    name: 'set_channel',
    description: 'Channel rack settings: volume 0-1, pan -1 (left) to 1 (right), mute, and the mixer insert it is routed to (0 = Master).',
    parameters: {
      type: 'object',
      properties: { channel: channelParam, volume: { type: 'number' }, pan: { type: 'number' }, mute: { type: 'boolean' }, insert: insertParam },
      required: ['channel'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const next: Channel = {
        ...ch,
        volume: a.volume === undefined ? ch.volume : clamp(num(a.volume, 'volume'), 0, 1),
        pan: a.pan === undefined ? ch.pan : clamp(num(a.pan, 'pan'), -1, 1),
        mute: a.mute === undefined ? ch.mute : Boolean(a.mute),
        insert: a.insert === undefined ? ch.insert : findInsert(p, a.insert),
      }
      return { project: updateChannel(p, ch.id, () => next), result: { channel: next.name, volume: next.volume, pan: next.pan, mute: next.mute, insert: next.insert } }
    },
  },

  // --- notes (in a pattern) ---
  {
    name: 'set_drum_steps',
    description: 'Set which 16th-note steps a drum channel hits in a pattern. Steps are 0-based (0 = beat 1 of bar 1, 4 = beat 2, 16 = bar 2).',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
        pattern: patternParam,
        steps: { type: 'array', items: { type: 'integer' } },
        velocities: { type: 'array', items: { type: 'number' }, description: 'Optional velocity (0-1) per step, same order as steps' },
        replace: { type: 'boolean', description: 'Replace existing hits (default true)' },
      },
      required: ['channel', 'steps'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const pat = findPattern(p, a.pattern)
      if (!Array.isArray(a.steps)) throw new Error('"steps" must be an array')
      const raw: number[] = a.steps.map((s: unknown) => Math.round(num(s, 'step')))
      const steps = [...new Set(raw)]
      const notes = buildNotes(pat, steps.map((s) => ({ start: s, length: 1, velocity: a.velocities?.[raw.indexOf(s)] ?? 0.85 })))
      const kept = a.replace === false ? notesOf(pat, ch.id).filter((n) => !steps.includes(n.start)) : []
      return { project: setNotes(p, pat.id, ch.id, [...kept, ...notes]), result: { channel: ch.name, pattern: pat.name, hits: kept.length + notes.length } }
    },
  },
  {
    name: 'toggle_step',
    description: 'Toggle a single step on a channel in a pattern.',
    parameters: { type: 'object', properties: { channel: channelParam, pattern: patternParam, step: { type: 'integer' } }, required: ['channel', 'step'] },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const pat = findPattern(p, a.pattern)
      const step = Math.round(num(a.step, 'step'))
      const cur = notesOf(pat, ch.id)
      const exists = cur.some((n) => Math.floor(n.start) === step)
      const notes = exists ? cur.filter((n) => Math.floor(n.start) !== step) : [...cur, ...buildNotes(pat, [{ start: step, length: 1, velocity: 0.85, pitch: 60 }])]
      return { project: setNotes(p, pat.id, ch.id, notes), result: { step, on: !exists } }
    },
  },
  {
    name: 'add_notes',
    description: 'Add notes to a channel in a pattern. start and length are in 16th-note steps. Pitch is a name like "C3" or a MIDI number (C4 = 60). Chords = several notes with the same start.',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
        pattern: patternParam,
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { pitch: { type: ['string', 'number'] }, start: { type: 'number' }, length: { type: 'number' }, velocity: { type: 'number' } },
            required: ['pitch', 'start', 'length'],
          },
        },
        replace: { type: 'boolean', description: 'Remove the existing notes of this channel in this pattern first (default false)' },
      },
      required: ['channel', 'notes'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const pat = findPattern(p, a.pattern)
      const notes = buildNotes(pat, a.notes)
      const base = a.replace ? [] : notesOf(pat, ch.id)
      return { project: setNotes(p, pat.id, ch.id, [...base, ...notes]), result: { channel: ch.name, pattern: pat.name, added: notes.length, ids: notes.map((n) => n.id) } }
    },
  },
  {
    name: 'remove_notes',
    description: 'Remove notes of a channel in a pattern. Without filters removes all of them. Filter by note ids, or by a step range [from_step, to_step).',
    parameters: {
      type: 'object',
      properties: { channel: channelParam, pattern: patternParam, ids: { type: 'array', items: { type: 'string' } }, from_step: { type: 'number' }, to_step: { type: 'number' } },
      required: ['channel'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const pat = findPattern(p, a.pattern)
      const ids: string[] | undefined = a.ids
      const from = a.from_step === undefined ? -Infinity : num(a.from_step, 'from_step')
      const to = a.to_step === undefined ? Infinity : num(a.to_step, 'to_step')
      const cur = notesOf(pat, ch.id)
      const notes = cur.filter((n) => !(ids ? ids.includes(n.id) : n.start >= from && n.start < to))
      return { project: setNotes(p, pat.id, ch.id, notes), result: { channel: ch.name, removed: cur.length - notes.length } }
    },
  },
  {
    name: 'update_note',
    description: 'Move, resize or re-pitch one note by id.',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
        pattern: patternParam,
        id: { type: 'string' },
        pitch: { type: ['string', 'number'] },
        start: { type: 'number' },
        length: { type: 'number' },
        velocity: { type: 'number' },
      },
      required: ['channel', 'id'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const pat = findPattern(p, a.pattern)
      const note = notesOf(pat, ch.id).find((n) => n.id === a.id)
      if (!note) throw new Error(`No note "${a.id}" on ${ch.name} in ${pat.name}`)
      const next: Note = {
        ...note,
        pitch: a.pitch === undefined ? note.pitch : clamp(parsePitch(a.pitch), 0, 127),
        start: a.start === undefined ? note.start : clamp(num(a.start, 'start'), 0, pat.lengthSteps - 0.25),
        length: a.length === undefined ? note.length : Math.max(0.25, num(a.length, 'length')),
        velocity: a.velocity === undefined ? note.velocity : clamp(num(a.velocity, 'velocity'), 0, 1),
      }
      return { project: setNotes(p, pat.id, ch.id, notesOf(pat, ch.id).map((n) => (n.id === note.id ? next : n))), result: { id: note.id } }
    },
  },
  {
    name: 'transpose',
    description: 'Shift all notes of a channel in a pattern by semitones (12 = one octave up).',
    parameters: { type: 'object', properties: { channel: channelParam, pattern: patternParam, semitones: { type: 'integer' } }, required: ['channel', 'semitones'] },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const pat = findPattern(p, a.pattern)
      const s = Math.round(num(a.semitones, 'semitones'))
      const notes = notesOf(pat, ch.id).map((n) => ({ ...n, pitch: clamp(n.pitch + s, 0, 127) }))
      return { project: setNotes(p, pat.id, ch.id, notes), result: { channel: ch.name, semitones: s } }
    },
  },

  // --- patterns ---
  {
    name: 'add_pattern',
    description: 'Create a new empty pattern (e.g. "Intro", "Chorus", "Drop") and make it the current pattern.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, bars: { type: 'integer', description: '1-8, default 2' } }, required: [] },
    apply: (p, a) => {
      const pat: Pattern = {
        id: newId('p'),
        name: uniqueName(p.patterns.map((x) => x.name), a.name ? String(a.name) : `Pattern ${p.patterns.length + 1}`),
        color: COLORS[p.patterns.length % COLORS.length],
        lengthSteps: clamp(Math.round(a.bars === undefined ? 2 : num(a.bars, 'bars')), 1, 8) * STEPS_PER_BAR,
        notes: {},
      }
      return { project: { ...p, patterns: [...p.patterns, pat], currentPatternId: pat.id }, result: { id: pat.id, name: pat.name } }
    },
  },
  {
    name: 'select_pattern',
    description: 'Make a pattern the current one (shown in the channel rack and piano roll, looped in PAT mode).',
    parameters: { type: 'object', properties: { pattern: patternParam }, required: ['pattern'] },
    apply: (p, a) => {
      const pat = findPattern(p, a.pattern)
      return { project: { ...p, currentPatternId: pat.id }, result: { current: pat.name } }
    },
  },
  {
    name: 'rename_pattern',
    description: 'Rename a pattern and optionally change its color (CSS color).',
    parameters: { type: 'object', properties: { pattern: patternParam, name: { type: 'string' }, color: { type: 'string' } }, required: ['pattern'] },
    apply: (p, a) => {
      const pat = findPattern(p, a.pattern)
      const name = a.name === undefined ? pat.name : String(a.name).trim()
      if (!name) throw new Error('Name cannot be empty')
      return { project: updatePattern(p, pat.id, (x) => ({ ...x, name, color: a.color ? String(a.color) : x.color })), result: { name } }
    },
  },
  {
    name: 'clone_pattern',
    description: 'Duplicate a pattern with all its notes, so you can make a variation. The copy becomes current.',
    parameters: { type: 'object', properties: { pattern: patternParam, name: { type: 'string' } }, required: [] },
    apply: (p, a) => {
      const src = findPattern(p, a.pattern)
      const copy: Pattern = {
        ...src,
        id: newId('p'),
        name: uniqueName(p.patterns.map((x) => x.name), a.name ? String(a.name) : `${src.name} copy`),
        notes: Object.fromEntries(Object.entries(src.notes).map(([cid, ns]) => [cid, ns.map((n) => ({ ...n, id: newId('n') }))])),
      }
      const i = p.patterns.findIndex((x) => x.id === src.id)
      const patterns = [...p.patterns.slice(0, i + 1), copy, ...p.patterns.slice(i + 1)]
      return { project: { ...p, patterns, currentPatternId: copy.id }, result: { id: copy.id, name: copy.name } }
    },
  },
  {
    name: 'delete_pattern',
    description: 'Delete a pattern and its clips in the playlist. The last pattern cannot be deleted.',
    parameters: { type: 'object', properties: { pattern: patternParam }, required: ['pattern'] },
    apply: (p, a) => {
      const pat = findPattern(p, a.pattern)
      if (p.patterns.length === 1) throw new Error('A project needs at least one pattern')
      const patterns = p.patterns.filter((x) => x.id !== pat.id)
      return {
        project: {
          ...p,
          patterns,
          playlist: p.playlist.filter((c) => c.patternId !== pat.id),
          currentPatternId: p.currentPatternId === pat.id ? patterns[0].id : p.currentPatternId,
        },
        result: { deleted: pat.name },
      }
    },
  },
  {
    name: 'set_pattern_length',
    description: 'Set a pattern length in bars (1-8). Notes past the new end are removed.',
    parameters: { type: 'object', properties: { pattern: patternParam, bars: { type: 'integer' } }, required: ['bars'] },
    apply: (p, a) => {
      const pat = findPattern(p, a.pattern)
      const bars = clamp(Math.round(num(a.bars, 'bars')), 1, 8)
      const lengthSteps = bars * STEPS_PER_BAR
      const notes = Object.fromEntries(Object.entries(pat.notes).map(([cid, ns]) => [cid, ns.filter((n) => n.start < lengthSteps)]))
      return { project: updatePattern(p, pat.id, (x) => ({ ...x, lengthSteps, notes })), result: { pattern: pat.name, bars } }
    },
  },

  // --- playlist ---
  {
    name: 'add_clip',
    description: 'Place a pattern on the playlist (song arrangement). track is the playlist row (0-based), bar is the start bar (0 = first bar). bars defaults to the pattern length.',
    parameters: {
      type: 'object',
      properties: { pattern: patternParam, track: { type: 'integer' }, bar: { type: 'number' }, bars: { type: 'number' } },
      required: ['pattern', 'track', 'bar'],
    },
    apply: (p, a) => {
      const pat = findPattern(p, a.pattern)
      const clip: Clip = {
        id: newId('k'),
        patternId: pat.id,
        track: clamp(Math.round(num(a.track, 'track')), 0, 31),
        start: Math.max(0, Math.round(num(a.bar, 'bar') * 4) / 4),
        length: Math.max(0.25, a.bars === undefined ? pat.lengthSteps / STEPS_PER_BAR : num(a.bars, 'bars')),
      }
      return { project: { ...p, playlist: [...p.playlist, clip] }, result: { id: clip.id, pattern: pat.name, track: clip.track, bar: clip.start } }
    },
  },
  {
    name: 'move_clip',
    description: 'Move or resize a playlist clip by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, track: { type: 'integer' }, bar: { type: 'number' }, bars: { type: 'number' } }, required: ['id'] },
    apply: (p, a) => {
      const clip = p.playlist.find((c) => c.id === a.id)
      if (!clip) throw new Error(`No clip "${a.id}"`)
      const next: Clip = {
        ...clip,
        track: a.track === undefined ? clip.track : clamp(Math.round(num(a.track, 'track')), 0, 31),
        start: a.bar === undefined ? clip.start : Math.max(0, Math.round(num(a.bar, 'bar') * 4) / 4),
        length: a.bars === undefined ? clip.length : Math.max(0.25, num(a.bars, 'bars')),
      }
      return { project: { ...p, playlist: p.playlist.map((c) => (c.id === clip.id ? next : c)) }, result: { id: clip.id } }
    },
  },
  {
    name: 'remove_clip',
    description: 'Remove a clip from the playlist by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    apply: (p, a) => {
      if (!p.playlist.some((c) => c.id === a.id)) throw new Error(`No clip "${a.id}"`)
      return { project: { ...p, playlist: p.playlist.filter((c) => c.id !== a.id) }, result: { removed: a.id } }
    },
  },

  // --- mixer ---
  {
    name: 'set_insert',
    description: 'Mixer insert settings. insert 0 is the Master. volume 0-1.25 (1 = unity), pan -1..1, mute, solo, name.',
    parameters: {
      type: 'object',
      properties: { insert: insertParam, name: { type: 'string' }, volume: { type: 'number' }, pan: { type: 'number' }, mute: { type: 'boolean' }, solo: { type: 'boolean' } },
      required: ['insert'],
    },
    apply: (p, a) => {
      const n = findInsert(p, a.insert)
      const ins = p.mixer[n]
      const next: Insert = {
        ...ins,
        name: a.name === undefined ? ins.name : String(a.name).trim() || ins.name,
        volume: a.volume === undefined ? ins.volume : clamp(num(a.volume, 'volume'), 0, 1.25),
        pan: a.pan === undefined ? ins.pan : clamp(num(a.pan, 'pan'), -1, 1),
        mute: a.mute === undefined ? ins.mute : Boolean(a.mute),
        solo: n === 0 || a.solo === undefined ? ins.solo : Boolean(a.solo),
      }
      return { project: updateInsert(p, n, () => next), result: { insert: n, name: next.name, volume: next.volume, pan: next.pan, mute: next.mute, solo: next.solo } }
    },
  },
  {
    name: 'add_fx',
    description: `Add an effect to the next free FX slot of a mixer insert (max ${MAX_FX_SLOTS}). Types: ${FX_TYPES.join(', ')}. All params and mix are 0-1. Params per type: ${fxParamsDoc}. filter mode: 0 lowpass, 0.5 highpass, 1 bandpass.`,
    parameters: {
      type: 'object',
      properties: { insert: insertParam, type: { type: 'string', enum: FX_TYPES }, mix: { type: 'number' }, params: { type: 'object' } },
      required: ['insert', 'type'],
    },
    apply: (p, a) => {
      const n = findInsert(p, a.insert)
      if (!FX_TYPES.includes(a.type)) throw new Error(`Unknown effect "${a.type}". Use one of: ${FX_TYPES.join(', ')}`)
      if (p.mixer[n].fx.length >= MAX_FX_SLOTS) throw new Error(`${p.mixer[n].name} has no free FX slot`)
      const fx = applyFxValues(newFx(a.type), a)
      return { project: updateInsert(p, n, (ins) => ({ ...ins, fx: [...ins.fx, fx] })), result: { insert: n, slot: p.mixer[n].fx.length, type: fx.type } }
    },
  },
  {
    name: 'set_fx',
    description: 'Change an effect in a mixer insert slot: turn it on/off, set mix (0-1) and params (0-1 each).',
    parameters: {
      type: 'object',
      properties: { insert: insertParam, slot: { type: 'integer' }, on: { type: 'boolean' }, mix: { type: 'number' }, params: { type: 'object' } },
      required: ['insert', 'slot'],
    },
    apply: (p, a) => {
      const n = findInsert(p, a.insert)
      const slot = Math.round(num(a.slot, 'slot'))
      const fx = p.mixer[n].fx[slot]
      if (!fx) throw new Error(`${p.mixer[n].name} has no effect in slot ${slot}`)
      const next = applyFxValues({ ...fx, on: a.on === undefined ? fx.on : Boolean(a.on) }, a)
      return { project: updateInsert(p, n, (ins) => ({ ...ins, fx: ins.fx.map((f, i) => (i === slot ? next : f)) })), result: { insert: n, slot, type: fx.type, on: next.on } }
    },
  },
  {
    name: 'remove_fx',
    description: 'Remove the effect in a mixer insert slot.',
    parameters: { type: 'object', properties: { insert: insertParam, slot: { type: 'integer' } }, required: ['insert', 'slot'] },
    apply: (p, a) => {
      const n = findInsert(p, a.insert)
      const slot = Math.round(num(a.slot, 'slot'))
      if (!p.mixer[n].fx[slot]) throw new Error(`${p.mixer[n].name} has no effect in slot ${slot}`)
      // Automation lanes pointing at later slots shift down with them.
      const prefix = `insert:${n}:fx:`
      const automation = p.automation
        .filter((l) => !l.target.startsWith(`${prefix}${slot}:`))
        .map((l) => {
          if (!l.target.startsWith(prefix)) return l
          const [s, ...rest] = l.target.slice(prefix.length).split(':')
          return Number(s) > slot ? { ...l, target: `${prefix}${Number(s) - 1}:${rest.join(':')}` } : l
        })
      return { project: { ...updateInsert(p, n, (ins) => ({ ...ins, fx: ins.fx.filter((_, i) => i !== slot) })), automation }, result: { insert: n, removed: slot } }
    },
  },

  // --- automation ---
  {
    name: 'set_automation',
    description:
      'Create or replace an automation lane that changes a parameter over the song. target: "insert:<n>:volume", "insert:<n>:pan", "insert:<n>:fx:<slot>:<param or mix>", "channel:<name>:volume" or "channel:<name>:pan". points: [{bar, value}] with bar in song bars (fractions allowed) and value 0-1 (pan: 0 = left, 0.5 = center, 1 = right). Only plays in SONG mode.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        points: { type: 'array', items: { type: 'object', properties: { bar: { type: 'number' }, value: { type: 'number' } }, required: ['bar', 'value'] } },
      },
      required: ['target', 'points'],
    },
    apply: (p, a) => {
      let target = String(a.target)
      const parts = target.split(':')
      if (parts[0] === 'channel') target = `channel:${findChannel(p, parts[1]).id}:${parts.slice(2).join(':')}`
      if (parts[0] === 'insert') target = `insert:${findInsert(p, parts[1])}:${parts.slice(2).join(':')}`
      const label = describeTarget(p, target)
      if (!Array.isArray(a.points) || a.points.length === 0) throw new Error('"points" must be a non-empty array')
      const points = a.points
        .map((pt: { bar: unknown; value: unknown }) => ({ t: Math.max(0, num(pt.bar, 'bar')) * STEPS_PER_BAR, v: clamp(num(pt.value, 'value'), 0, 1) }))
        .sort((x: { t: number }, y: { t: number }) => x.t - y.t)
      const existing = p.automation.find((l) => l.target === target)
      const lane: AutomationLane = { id: existing?.id ?? newId('a'), target, points }
      const automation = existing ? p.automation.map((l) => (l.id === lane.id ? lane : l)) : [...p.automation, lane]
      return { project: { ...p, automation }, result: { id: lane.id, target: label, points: points.length } }
    },
  },
  {
    name: 'remove_automation',
    description: 'Delete an automation lane by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    apply: (p, a) => {
      if (!p.automation.some((l) => l.id === a.id)) throw new Error(`No automation lane "${a.id}"`)
      return { project: { ...p, automation: p.automation.filter((l) => l.id !== a.id) }, result: { removed: a.id } }
    },
  },
]

function uniqueName(taken: string[], wanted: string): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()))
  let name = wanted.trim() || 'Untitled'
  for (let i = 2; lower.has(name.toLowerCase()); i++) name = `${wanted.trim()} ${i}`
  return name
}

function addChannel(p: Project, c: { name: string; type: Channel['type']; sound: string; sampleId?: string }): CommandResult {
  const used = new Set(p.channels.map((ch) => ch.insert))
  let insert = 1
  while (insert <= INSERT_COUNT && used.has(insert)) insert++
  if (insert > INSERT_COUNT) insert = 0
  const name = uniqueName(p.channels.map((ch) => ch.name), c.name)
  const channel: Channel = {
    id: newId('c'),
    name,
    type: c.type,
    sound: c.sound,
    ...(c.sampleId ? { sampleId: c.sampleId } : {}),
    volume: 0.8,
    pan: 0,
    mute: false,
    insert,
    color: COLORS[p.channels.length % COLORS.length],
  }
  // Name the insert after its first channel, like FL does when you route a fresh channel.
  const mixer = insert && p.mixer[insert].name === `Insert ${insert}` ? p.mixer.map((ins, i) => (i === insert ? { ...ins, name } : ins)) : p.mixer
  return { project: { ...p, channels: [...p.channels, channel], mixer }, result: { id: channel.id, name, insert } }
}

function applyFxValues(fx: FxSlot, a: { mix?: unknown; params?: Record<string, unknown> }): FxSlot {
  const params = { ...fx.params }
  if (a.params && typeof a.params === 'object') {
    for (const [k, v] of Object.entries(a.params)) {
      if (!(k in params)) throw new Error(`${FX_DEFS[fx.type].label} has no parameter "${k}". Use: ${Object.keys(params).join(', ')}`)
      params[k] = clamp(num(v, k), 0, 1)
    }
  }
  return { ...fx, mix: a.mix === undefined ? fx.mix : clamp(num(a.mix, 'mix'), 0, 1), params }
}

export const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.name, c]))

export function applyCommand(project: Project, name: string, args: unknown): CommandResult {
  const cmd = COMMAND_MAP.get(name)
  if (!cmd) throw new Error(`Unknown command "${name}"`)
  return cmd.apply(project, args ?? {})
}

export function emptyProject(): Project {
  const pattern: Pattern = { id: newId('p'), name: 'Pattern 1', color: COLORS[0], lengthSteps: 32, notes: {} }
  return {
    version: 2,
    bpm: 120,
    swing: 0,
    keyRoot: 0,
    scale: 'minor',
    channels: [],
    patterns: [pattern],
    currentPatternId: pattern.id,
    playlist: [],
    automation: [],
    mixer: Array.from({ length: INSERT_COUNT + 1 }, (_, i) => newInsert(i)),
    songMode: false,
  }
}

/** Upgrades projects saved by older versions (single pattern, notes on channels). */
export function migrateProject(raw: any): Project {
  if (raw?.version === 2) return raw as Project
  const base = emptyProject()
  if (!raw || !Array.isArray(raw.channels)) return base
  const pattern: Pattern = { ...base.patterns[0], lengthSteps: raw.lengthSteps ?? 32, notes: {} }
  const channels: Channel[] = raw.channels.map((c: any, i: number) => {
    pattern.notes[c.id] = c.notes ?? []
    return { id: c.id, name: c.name, type: c.type, sound: c.sound, volume: c.volume ?? 0.8, pan: c.pan ?? 0, mute: Boolean(c.mute), insert: i < INSERT_COUNT ? i + 1 : 0, color: c.color ?? COLORS[i % COLORS.length] }
  })
  const mixer = base.mixer.map((ins, i) => (i === 0 ? { ...ins, volume: raw.masterVolume ?? ins.volume } : ins))
  channels.forEach((c, i) => {
    if (c.insert) mixer[c.insert] = { ...mixer[c.insert], name: c.name, solo: Boolean(raw.channels[i].solo) }
  })
  return { ...base, bpm: raw.bpm ?? 120, swing: raw.swing ?? 0, keyRoot: raw.keyRoot ?? 0, scale: raw.scale ?? 'minor', channels, patterns: [pattern], currentPatternId: pattern.id, mixer }
}

/** A starter song so the app makes sound on first launch. */
export function demoProject(): Project {
  let p = emptyProject()
  const run = (name: string, args: unknown) => {
    p = applyCommand(p, name, args).project
    return p
  }
  run('set_tempo', { bpm: 128 })
  run('set_key', { root: 'A', scale: 'minor' })
  run('rename_pattern', { pattern: 'Pattern 1', name: 'Beat' })
  run('add_channel', { name: 'Kick', type: 'drum', sound: 'kick' })
  run('add_channel', { name: 'Clap', type: 'drum', sound: 'clap' })
  run('add_channel', { name: 'Hat', type: 'drum', sound: 'hat' })
  run('add_channel', { name: 'Bass', type: 'synth', sound: 'bass' })
  run('add_channel', { name: 'Pad', type: 'synth', sound: 'pad' })
  run('set_drum_steps', { channel: 'Kick', steps: [0, 4, 8, 12, 16, 20, 24, 28] })
  run('set_drum_steps', { channel: 'Clap', steps: [4, 12, 20, 28] })
  run('set_drum_steps', { channel: 'Hat', steps: [2, 6, 10, 14, 18, 22, 26, 30] })
  run('add_notes', {
    channel: 'Bass',
    notes: [
      { pitch: 'A1', start: 0, length: 3 },
      { pitch: 'A1', start: 6, length: 2 },
      { pitch: 'C2', start: 10, length: 2 },
      { pitch: 'E2', start: 14, length: 2 },
      { pitch: 'F1', start: 16, length: 3 },
      { pitch: 'F1', start: 22, length: 2 },
      { pitch: 'G1', start: 26, length: 2 },
      { pitch: 'E1', start: 30, length: 2 },
    ],
  })
  run('add_pattern', { name: 'Chords', bars: 2 })
  run('add_notes', {
    channel: 'Pad',
    notes: ['A3', 'C4', 'E4'].map((pitch) => ({ pitch, start: 0, length: 16 })).concat(['F3', 'A3', 'C4'].map((pitch) => ({ pitch, start: 16, length: 16 }))),
  })
  run('select_pattern', { pattern: 'Beat' })
  run('add_clip', { pattern: 'Chords', track: 1, bar: 0 })
  run('add_clip', { pattern: 'Chords', track: 1, bar: 2 })
  run('add_clip', { pattern: 'Beat', track: 0, bar: 2 })
  run('add_clip', { pattern: 'Chords', track: 1, bar: 4 })
  run('add_clip', { pattern: 'Beat', track: 0, bar: 4 })
  run('add_fx', { insert: 'Pad', type: 'reverb', mix: 0.35 })
  run('add_fx', { insert: 'Clap', type: 'reverb', mix: 0.2, params: { size: 0.4 } })
  run('add_fx', { insert: 'Master', type: 'compressor' })
  run('set_automation', { target: 'insert:Pad:fx:0:mix', points: [{ bar: 0, value: 0.6 }, { bar: 4, value: 0.15 }, { bar: 6, value: 0.5 }] })
  return p
}
