export const DRUM_SOUNDS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'rim', 'crash'] as const
export const SYNTH_SOUNDS = ['bass', 'sub', 'lead', 'pad', 'pluck', 'keys'] as const

export type DrumSound = (typeof DRUM_SOUNDS)[number]
export type SynthSound = (typeof SYNTH_SOUNDS)[number]
export type ChannelType = 'drum' | 'synth' | 'sample'

/** Positions and lengths are measured in steps (one step = a 16th note). */
export interface Note {
  id: string
  pitch: number // MIDI note number; drums ignore it, samples play C4 (60) at original pitch
  start: number
  length: number
  velocity: number // 0..1
}

export interface Channel {
  id: string
  name: string
  type: ChannelType
  sound: string // DrumSound | SynthSound, or the file name for samples
  sampleId?: string // IndexedDB key of the audio file, for type 'sample'
  volume: number // 0..1
  pan: number // -1..1
  mute: boolean
  insert: number // mixer insert this channel is routed to (0 = master)
  color: string
}

export interface Pattern {
  id: string
  name: string
  color: string
  lengthSteps: number
  notes: Record<string, Note[]> // by channel id
}

/** A pattern placed on the playlist. start and length are in bars. */
export interface Clip {
  id: string
  patternId: string
  track: number
  start: number
  length: number
}

export const FX_DEFS = {
  reverb: { label: 'Reverb', params: { size: 0.6, damp: 0.5 } },
  delay: { label: 'Delay', params: { time: 0.5, feedback: 0.4 } },
  filter: { label: 'Filter', params: { cutoff: 0.6, resonance: 0.2, mode: 0 } },
  distortion: { label: 'Distortion', params: { drive: 0.4, tone: 0.6 } },
  eq: { label: 'EQ', params: { low: 0.5, mid: 0.5, high: 0.5 } },
  compressor: { label: 'Compressor', params: { threshold: 0.6, ratio: 0.4, makeup: 0.3 } },
  chorus: { label: 'Chorus', params: { rate: 0.3, depth: 0.5 } },
} as const

export type FxType = keyof typeof FX_DEFS
export const FX_TYPES = Object.keys(FX_DEFS) as FxType[]

/** Every effect parameter is normalized 0..1; the engine maps it to real units. */
export interface FxSlot {
  id: string
  type: FxType
  on: boolean
  mix: number
  params: Record<string, number>
}

export interface Insert {
  name: string
  volume: number // 0..1.25 (fader can push a little above unity)
  pan: number
  mute: boolean
  solo: boolean
  fx: FxSlot[]
}

export const INSERT_COUNT = 16 // plus the master at index 0
export const MAX_FX_SLOTS = 8

/**
 * Automation target paths:
 *   insert:<n>:volume | insert:<n>:pan | insert:<n>:fx:<slot>:<param or "mix">
 *   channel:<id>:volume | channel:<id>:pan
 * Points: t in song steps, v normalized 0..1.
 */
export interface AutomationLane {
  id: string
  target: string
  points: { t: number; v: number }[]
}

export interface Project {
  version: 2
  bpm: number
  swing: number // 0..1
  keyRoot: number // 0 = C … 11 = B
  scale: ScaleName
  channels: Channel[]
  patterns: Pattern[]
  currentPatternId: string
  playlist: Clip[]
  automation: AutomationLane[]
  mixer: Insert[] // index 0 = master
  songMode: boolean
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonicMinor: [0, 3, 5, 7, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const

export type ScaleName = keyof typeof SCALES

export const STEPS_PER_BAR = 16
