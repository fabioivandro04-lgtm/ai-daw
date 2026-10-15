import { NOTE_NAMES, parseKeyRoot, parsePitch, midiToName } from './music'
import {
  DRUM_SOUNDS,
  SCALES,
  STEPS_PER_BAR,
  SYNTH_SOUNDS,
  type Channel,
  type DrumSound,
  type Note,
  type Project,
  type ScaleName,
  type SynthSound,
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

const COLORS = ['#ff8a3d', '#ffd23d', '#5ee0a0', '#4cc3ff', '#a98bff', '#ff6fb1', '#9be15d', '#ff5f5f']

let idCounter = 0
export function newId(prefix: string): string {
  idCounter += 1
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function findChannel(project: Project, ref: string): Channel {
  const r = String(ref).trim().toLowerCase()
  const ch =
    project.channels.find((c) => c.id === ref) ??
    project.channels.find((c) => c.name.toLowerCase() === r)
  if (!ch) {
    const names = project.channels.map((c) => `"${c.name}"`).join(', ') || 'none'
    throw new Error(`No channel "${ref}". Existing channels: ${names}`)
  }
  return ch
}

function updateChannel(project: Project, id: string, fn: (c: Channel) => Channel): Project {
  return { ...project, channels: project.channels.map((c) => (c.id === id ? fn(c) : c)) }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function num(v: unknown, name: string): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`"${name}" must be a number`)
  return n
}

const channelParam = { type: 'string', description: 'Channel name or id' }

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

interface NoteInput {
  pitch?: string | number
  start: number
  length?: number
  velocity?: number
}

function buildNotes(project: Project, input: NoteInput[]): Note[] {
  if (!Array.isArray(input)) throw new Error('"notes" must be an array')
  return input.map((n) => {
    const start = num(n.start, 'start')
    if (start < 0 || start >= project.lengthSteps)
      throw new Error(`Note start ${start} is outside the pattern (0-${project.lengthSteps - 1})`)
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

export function summarizeChannel(c: Channel) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    sound: c.sound,
    volume: Math.round(c.volume * 100) / 100,
    pan: c.pan,
    mute: c.mute,
    solo: c.solo,
    notes:
      c.type === 'drum'
        ? { steps: c.notes.map((n) => n.start) }
        : c.notes.map((n) => [midiToName(n.pitch), n.start, n.length]),
  }
}

export function summarizeProject(p: Project) {
  return {
    bpm: p.bpm,
    swing: p.swing,
    bars: p.lengthSteps / STEPS_PER_BAR,
    lengthSteps: p.lengthSteps,
    key: `${NOTE_NAMES[p.keyRoot]} ${p.scale}`,
    channels: p.channels.map(summarizeChannel),
  }
}

export const COMMANDS: Command[] = [
  {
    name: 'set_tempo',
    description: 'Set the project tempo in BPM (40-300).',
    parameters: {
      type: 'object',
      properties: { bpm: { type: 'number' } },
      required: ['bpm'],
    },
    apply: (p, a) => {
      const bpm = clamp(Math.round(num(a.bpm, 'bpm')), 40, 300)
      return { project: { ...p, bpm }, result: { bpm } }
    },
  },
  {
    name: 'set_swing',
    description: 'Set the swing amount from 0 (straight) to 1 (heavy shuffle).',
    parameters: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    apply: (p, a) => {
      const swing = clamp(num(a.amount, 'amount'), 0, 1)
      return { project: { ...p, swing }, result: { swing } }
    },
  },
  {
    name: 'set_pattern_length',
    description: 'Set the loop length in bars (1-8). Notes past the new end are removed.',
    parameters: {
      type: 'object',
      properties: { bars: { type: 'integer' } },
      required: ['bars'],
    },
    apply: (p, a) => {
      const bars = clamp(Math.round(num(a.bars, 'bars')), 1, 8)
      const lengthSteps = bars * STEPS_PER_BAR
      return {
        project: {
          ...p,
          lengthSteps,
          channels: p.channels.map((c) => ({ ...c, notes: c.notes.filter((n) => n.start < lengthSteps) })),
        },
        result: { bars, lengthSteps },
      }
    },
  },
  {
    name: 'set_key',
    description: 'Set the musical key used for scale snapping and suggestions.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Root note, e.g. "C", "F#", "Bb"' },
        scale: { type: 'string', enum: Object.keys(SCALES) },
      },
      required: ['root', 'scale'],
    },
    apply: (p, a) => {
      if (!(a.scale in SCALES)) throw new Error(`Unknown scale "${a.scale}"`)
      const keyRoot = parseKeyRoot(a.root)
      return { project: { ...p, keyRoot, scale: a.scale as ScaleName }, result: { root: a.root, scale: a.scale } }
    },
  },
  {
    name: 'add_channel',
    description:
      'Add an instrument channel. Drum channels play one drum sound; synth channels play melodic notes.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['drum', 'synth'] },
        sound: {
          type: 'string',
          enum: [...DRUM_SOUNDS, ...SYNTH_SOUNDS],
          description: `Drum sounds: ${DRUM_SOUNDS.join(', ')}. Synth sounds: ${SYNTH_SOUNDS.join(', ')}.`,
        },
      },
      required: ['name', 'type', 'sound'],
    },
    apply: (p, a) => {
      const type = a.type === 'drum' ? 'drum' : 'synth'
      const valid: readonly string[] = type === 'drum' ? DRUM_SOUNDS : SYNTH_SOUNDS
      if (!valid.includes(a.sound)) throw new Error(`"${a.sound}" is not a ${type} sound. Use one of: ${valid.join(', ')}`)
      let name = String(a.name || a.sound).trim()
      const taken = new Set(p.channels.map((c) => c.name.toLowerCase()))
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${a.name || a.sound} ${i}`
      const channel: Channel = {
        id: newId('c'),
        name,
        type,
        sound: a.sound as DrumSound | SynthSound,
        notes: [],
        volume: 0.8,
        pan: 0,
        mute: false,
        solo: false,
        color: COLORS[p.channels.length % COLORS.length],
      }
      return { project: { ...p, channels: [...p.channels, channel] }, result: { id: channel.id, name } }
    },
  },
  {
    name: 'remove_channel',
    description: 'Delete a channel and its notes.',
    parameters: { type: 'object', properties: { channel: channelParam }, required: ['channel'] },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      return { project: { ...p, channels: p.channels.filter((c) => c.id !== ch.id) }, result: { removed: ch.name } }
    },
  },
  {
    name: 'rename_channel',
    description: 'Rename a channel.',
    parameters: {
      type: 'object',
      properties: { channel: channelParam, name: { type: 'string' } },
      required: ['channel', 'name'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const name = String(a.name).trim()
      if (!name) throw new Error('Name cannot be empty')
      return { project: updateChannel(p, ch.id, (c) => ({ ...c, name })), result: { name } }
    },
  },
  {
    name: 'set_channel_sound',
    description: 'Change the sound a channel plays (must match the channel type).',
    parameters: {
      type: 'object',
      properties: { channel: channelParam, sound: { type: 'string', enum: [...DRUM_SOUNDS, ...SYNTH_SOUNDS] } },
      required: ['channel', 'sound'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const valid: readonly string[] = ch.type === 'drum' ? DRUM_SOUNDS : SYNTH_SOUNDS
      if (!valid.includes(a.sound)) throw new Error(`"${a.sound}" is not a ${ch.type} sound. Use one of: ${valid.join(', ')}`)
      return { project: updateChannel(p, ch.id, (c) => ({ ...c, sound: a.sound })), result: { sound: a.sound } }
    },
  },
  {
    name: 'set_drum_steps',
    description:
      'Set which 16th-note steps a drum channel hits. Steps are 0-based (0 = beat 1 of bar 1, 4 = beat 2, 16 = bar 2).',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
        steps: { type: 'array', items: { type: 'integer' } },
        velocities: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional velocity (0-1) per step, same order as steps',
        },
        replace: { type: 'boolean', description: 'Replace existing hits (default true)' },
      },
      required: ['channel', 'steps'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      if (!Array.isArray(a.steps)) throw new Error('"steps" must be an array')
      const steps: number[] = [...new Set<number>(a.steps.map((s: unknown) => Math.round(num(s, 'step'))))]
      const notes = buildNotes(
        p,
        steps.map((s, i) => ({ start: s, length: 1, velocity: a.velocities?.[i] ?? 0.85 })),
      )
      const replace = a.replace !== false
      const kept = replace ? [] : ch.notes.filter((n) => !steps.includes(n.start))
      return {
        project: updateChannel(p, ch.id, (c) => ({ ...c, notes: sortNotes([...kept, ...notes]) })),
        result: { channel: ch.name, hits: kept.length + notes.length },
      }
    },
  },
  {
    name: 'toggle_step',
    description: 'Toggle a single step on a drum channel.',
    parameters: {
      type: 'object',
      properties: { channel: channelParam, step: { type: 'integer' } },
      required: ['channel', 'step'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const step = Math.round(num(a.step, 'step'))
      const exists = ch.notes.some((n) => Math.floor(n.start) === step)
      const notes = exists
        ? ch.notes.filter((n) => Math.floor(n.start) !== step)
        : sortNotes([...ch.notes, ...buildNotes(p, [{ start: step, length: 1, velocity: 0.85 }])])
      return { project: updateChannel(p, ch.id, (c) => ({ ...c, notes })), result: { step, on: !exists } }
    },
  },
  {
    name: 'add_notes',
    description:
      'Add notes to a channel. start and length are in 16th-note steps. Pitch is a name like "C3" or a MIDI number (C4 = 60). Chords = several notes with the same start.',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pitch: { type: ['string', 'number'] },
              start: { type: 'number' },
              length: { type: 'number' },
              velocity: { type: 'number' },
            },
            required: ['pitch', 'start', 'length'],
          },
        },
        replace: { type: 'boolean', description: 'Remove all existing notes on the channel first (default false)' },
      },
      required: ['channel', 'notes'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const notes = buildNotes(p, a.notes)
      const base = a.replace ? [] : ch.notes
      return {
        project: updateChannel(p, ch.id, (c) => ({ ...c, notes: sortNotes([...base, ...notes]) })),
        result: { channel: ch.name, added: notes.length, ids: notes.map((n) => n.id) },
      }
    },
  },
  {
    name: 'remove_notes',
    description:
      'Remove notes from a channel. Without filters removes everything. Filter by note ids, or by a step range [from_step, to_step).',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
        ids: { type: 'array', items: { type: 'string' } },
        from_step: { type: 'number' },
        to_step: { type: 'number' },
      },
      required: ['channel'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const ids: string[] | undefined = a.ids
      const from = a.from_step === undefined ? -Infinity : num(a.from_step, 'from_step')
      const to = a.to_step === undefined ? Infinity : num(a.to_step, 'to_step')
      const remove = (n: Note) => (ids ? ids.includes(n.id) : n.start >= from && n.start < to)
      const notes = ch.notes.filter((n) => !remove(n))
      return {
        project: updateChannel(p, ch.id, (c) => ({ ...c, notes })),
        result: { channel: ch.name, removed: ch.notes.length - notes.length },
      }
    },
  },
  {
    name: 'update_note',
    description: 'Move, resize or re-pitch one note by id.',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
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
      const note = ch.notes.find((n) => n.id === a.id)
      if (!note) throw new Error(`No note "${a.id}" on ${ch.name}`)
      const next: Note = {
        ...note,
        pitch: a.pitch === undefined ? note.pitch : clamp(parsePitch(a.pitch), 0, 127),
        start: a.start === undefined ? note.start : clamp(num(a.start, 'start'), 0, p.lengthSteps - 0.25),
        length: a.length === undefined ? note.length : Math.max(0.25, num(a.length, 'length')),
        velocity: a.velocity === undefined ? note.velocity : clamp(num(a.velocity, 'velocity'), 0, 1),
      }
      return {
        project: updateChannel(p, ch.id, (c) => ({
          ...c,
          notes: sortNotes(c.notes.map((n) => (n.id === note.id ? next : n))),
        })),
        result: { id: note.id },
      }
    },
  },
  {
    name: 'transpose',
    description: 'Shift all notes on a synth channel by a number of semitones (12 = one octave up).',
    parameters: {
      type: 'object',
      properties: { channel: channelParam, semitones: { type: 'integer' } },
      required: ['channel', 'semitones'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const s = Math.round(num(a.semitones, 'semitones'))
      return {
        project: updateChannel(p, ch.id, (c) => ({
          ...c,
          notes: c.notes.map((n) => ({ ...n, pitch: clamp(n.pitch + s, 0, 127) })),
        })),
        result: { channel: ch.name, semitones: s },
      }
    },
  },
  {
    name: 'set_mixer',
    description: 'Change a channel mixer settings: volume 0-1, pan -1 (left) to 1 (right), mute, solo.',
    parameters: {
      type: 'object',
      properties: {
        channel: channelParam,
        volume: { type: 'number' },
        pan: { type: 'number' },
        mute: { type: 'boolean' },
        solo: { type: 'boolean' },
      },
      required: ['channel'],
    },
    apply: (p, a) => {
      const ch = findChannel(p, a.channel)
      const next: Channel = {
        ...ch,
        volume: a.volume === undefined ? ch.volume : clamp(num(a.volume, 'volume'), 0, 1),
        pan: a.pan === undefined ? ch.pan : clamp(num(a.pan, 'pan'), -1, 1),
        mute: a.mute === undefined ? ch.mute : Boolean(a.mute),
        solo: a.solo === undefined ? ch.solo : Boolean(a.solo),
      }
      return { project: updateChannel(p, ch.id, () => next), result: summarizeChannel(next) }
    },
  },
  {
    name: 'set_master_volume',
    description: 'Set master output volume 0-1.',
    parameters: { type: 'object', properties: { volume: { type: 'number' } }, required: ['volume'] },
    apply: (p, a) => {
      const masterVolume = clamp(num(a.volume, 'volume'), 0, 1)
      return { project: { ...p, masterVolume }, result: { masterVolume } }
    },
  },
]

export const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.name, c]))

export function applyCommand(project: Project, name: string, args: unknown): CommandResult {
  const cmd = COMMAND_MAP.get(name)
  if (!cmd) throw new Error(`Unknown command "${name}"`)
  return cmd.apply(project, args ?? {})
}

export function emptyProject(): Project {
  return { bpm: 120, swing: 0, lengthSteps: 32, keyRoot: 0, scale: 'minor', masterVolume: 0.8, channels: [] }
}

/** A starter project so the app makes sound on first launch. */
export function demoProject(): Project {
  let p = emptyProject()
  const run = (name: string, args: unknown) => {
    p = applyCommand(p, name, args).project
  }
  run('set_tempo', { bpm: 128 })
  run('set_key', { root: 'A', scale: 'minor' })
  run('add_channel', { name: 'Kick', type: 'drum', sound: 'kick' })
  run('add_channel', { name: 'Clap', type: 'drum', sound: 'clap' })
  run('add_channel', { name: 'Hat', type: 'drum', sound: 'hat' })
  run('add_channel', { name: 'Bass', type: 'synth', sound: 'bass' })
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
  return p
}
