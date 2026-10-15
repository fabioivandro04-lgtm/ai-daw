export const DRUM_SOUNDS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'rim', 'crash'] as const
export const SYNTH_SOUNDS = ['bass', 'sub', 'lead', 'pad', 'pluck', 'keys'] as const

export type DrumSound = (typeof DRUM_SOUNDS)[number]
export type SynthSound = (typeof SYNTH_SOUNDS)[number]
export type ChannelType = 'drum' | 'synth'

/** Positions and lengths are measured in steps (one step = a 16th note). */
export interface Note {
  id: string
  pitch: number // MIDI note number; drums ignore it
  start: number
  length: number
  velocity: number // 0..1
}

export interface Channel {
  id: string
  name: string
  type: ChannelType
  sound: DrumSound | SynthSound
  notes: Note[]
  volume: number // 0..1
  pan: number // -1..1
  mute: boolean
  solo: boolean
  color: string
}

export interface Project {
  bpm: number
  swing: number // 0..1
  lengthSteps: number
  keyRoot: number // 0 = C … 11 = B
  scale: ScaleName
  masterVolume: number
  channels: Channel[]
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
