import { SCALES, type ScaleName } from './types'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const FLATS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }

/** MIDI 60 = C4. */
export function midiToName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}

/** Accepts "C4", "f#2", "Bb3" or a MIDI number (as number or numeric string). */
export function parsePitch(input: string | number): number {
  if (typeof input === 'number') return Math.round(input)
  const s = input.trim()
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s)
  if (!m) throw new Error(`Invalid pitch "${input}". Use a name like "C3" or a MIDI number.`)
  let name = m[1].toUpperCase() + m[2]
  name = FLATS[name] ?? name
  const pc = NOTE_NAMES.indexOf(name)
  if (pc < 0) throw new Error(`Invalid pitch "${input}"`)
  return pc + (parseInt(m[3], 10) + 1) * 12
}

export function parseKeyRoot(input: string): number {
  const name = input.trim().charAt(0).toUpperCase() + input.trim().slice(1)
  const idx = NOTE_NAMES.indexOf(FLATS[name] ?? name)
  if (idx < 0) throw new Error(`Invalid key root "${input}"`)
  return idx
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

export function inScale(midi: number, root: number, scale: ScaleName): boolean {
  const pc = (((midi - root) % 12) + 12) % 12
  return (SCALES[scale] as readonly number[]).includes(pc)
}

/** Moves a pitch to the nearest note of the scale (ties go down). */
export function snapToScale(midi: number, root: number, scale: ScaleName): number {
  for (let d = 0; d < 12; d++) {
    if (inScale(midi - d, root, scale)) return midi - d
    if (inScale(midi + d, root, scale)) return midi + d
  }
  return midi
}

export function stepDuration(bpm: number): number {
  return 60 / bpm / 4
}
