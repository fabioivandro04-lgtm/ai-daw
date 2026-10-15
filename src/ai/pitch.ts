import { freqToMidi, snapToScale, stepDuration } from '../core/music'
import type { ScaleName } from '../core/types'
import { downsample, median, rms } from './dsp'

/**
 * Hum / sing → notes.
 * 1. Track pitch frame by frame with the YIN algorithm.
 * 2. Split the pitch track into notes on silence, pitch jumps or new attacks.
 * 3. Quantize to the project grid and key.
 */

export interface DetectedNote {
  midi: number
  time: number // seconds
  duration: number // seconds
  velocity: number // 0..1
}

const ANALYSIS_RATE = 16000
const FRAME = 1024
const HOP = 160 // 10 ms at 16 kHz

/** YIN fundamental-frequency estimate for one frame, or null when unvoiced. */
export function yin(
  x: Float32Array,
  offset: number,
  frame: number,
  sampleRate: number,
  minFreq = 55,
  maxFreq = 1000,
  threshold = 0.15,
): number | null {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq))
  const tauMax = Math.min(Math.floor(sampleRate / minFreq), Math.floor(frame / 2))
  const w = frame - tauMax
  const d = new Float64Array(tauMax + 1)
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0
    for (let j = 0; j < w; j++) {
      const diff = x[offset + j] - x[offset + j + tau]
      s += diff * diff
    }
    d[tau] = s
  }
  // Cumulative mean normalized difference.
  const cmnd = new Float64Array(tauMax + 1)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1
  }
  let tau = -1
  for (let t = tauMin; t < tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) return null
  // Parabolic interpolation around the minimum for sub-sample accuracy.
  const a = cmnd[tau - 1]
  const b = cmnd[tau]
  const c = cmnd[tau + 1] ?? b
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0
  return sampleRate / (tau + shift)
}

interface Frame {
  time: number
  midi: number | null
  level: number
}

export function pitchTrack(samples: Float32Array, sampleRate: number): Frame[] {
  const { data, sampleRate: sr } = downsample(samples, sampleRate, ANALYSIS_RATE)
  const frames: Frame[] = []
  for (let off = 0; off + FRAME <= data.length; off += HOP) {
    const level = rms(data, off, off + FRAME)
    const f = yin(data, off, FRAME, sr)
    frames.push({ time: off / sr, midi: f ? freqToMidi(f) : null, level })
  }
  const maxLevel = Math.max(0, ...frames.map((f) => f.level))
  const gate = Math.max(0.004, maxLevel * 0.12)
  for (const f of frames) if (f.level < gate) f.midi = null
  // Median-smooth voiced frames to remove octave glitches.
  const smoothed = frames.map((f, i) => {
    if (f.midi === null) return f
    const win: number[] = []
    for (let k = i - 2; k <= i + 2; k++) {
      const m = frames[k]?.midi
      if (m !== null && m !== undefined) win.push(m)
    }
    return { ...f, midi: median(win) }
  })
  return smoothed
}

export function segmentNotes(frames: Frame[], frameSeconds = HOP / ANALYSIS_RATE): DetectedNote[] {
  const notes: DetectedNote[] = []
  const maxLevel = Math.max(1e-9, ...frames.map((f) => f.level))
  let cur: { start: number; pitches: number[]; levels: number[] } | null = null

  const close = (endTime: number) => {
    if (!cur) return
    const duration = endTime - cur.start
    if (duration >= 0.07) {
      notes.push({
        midi: Math.round(median(cur.pitches)),
        time: cur.start,
        duration,
        velocity: Math.min(1, 0.35 + (0.65 * Math.max(...cur.levels)) / maxLevel),
      })
    }
    cur = null
  }

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (f.midi === null) {
      close(f.time)
      continue
    }
    if (cur) {
      const ref = median(cur.pitches.slice(-8))
      const prevLevel = frames[Math.max(0, i - 3)].level
      const pitchJump = Math.abs(f.midi - ref) > 0.75
      const newAttack = f.level > prevLevel * 2.2 && cur.pitches.length > 5
      if (pitchJump || newAttack) close(f.time)
    }
    if (!cur) cur = { start: f.time, pitches: [], levels: [] }
    cur.pitches.push(f.midi)
    cur.levels.push(f.level)
  }
  close(frames.length ? frames[frames.length - 1].time + frameSeconds : 0)
  return notes
}

export function detectNotes(samples: Float32Array, sampleRate: number): DetectedNote[] {
  return segmentNotes(pitchTrack(samples, sampleRate))
}

export interface QuantizeOptions {
  bpm: number
  lengthSteps: number
  keyRoot: number
  scale: ScaleName
  snapToKey: boolean
  /** Shift the line by whole octaves so its median pitch lands near this MIDI note. */
  targetCenter?: number
  /** Shift timing so the first note lands on step 0. */
  alignFirst: boolean
}

export interface QuantizedNote {
  pitch: number
  start: number
  length: number
  velocity: number
}

export function quantizeNotes(detected: DetectedNote[], o: QuantizeOptions): QuantizedNote[] {
  if (detected.length === 0) return []
  const sd = stepDuration(o.bpm)
  const offset = o.alignFirst ? detected[0].time : 0
  let octaveShift = 0
  if (o.targetCenter !== undefined) {
    const med = median(detected.map((n) => n.midi))
    octaveShift = Math.round((o.targetCenter - med) / 12) * 12
  }
  const out: QuantizedNote[] = []
  for (const n of detected) {
    const start = Math.round((n.time - offset) / sd)
    if (start < 0 || start >= o.lengthSteps) continue
    let pitch = n.midi + octaveShift
    if (o.snapToKey) pitch = snapToScale(pitch, o.keyRoot, o.scale)
    const length = Math.max(1, Math.min(Math.round(n.duration / sd), o.lengthSteps - start))
    const prev = out[out.length - 1]
    if (prev && prev.start === start) {
      // Two notes collapsed onto one step: keep the longer one.
      if (length > prev.length) out[out.length - 1] = { pitch, start, length, velocity: n.velocity }
      continue
    }
    if (prev && prev.start + prev.length > start) prev.length = start - prev.start
    out.push({ pitch, start, length, velocity: n.velocity })
  }
  return out
}

/** Suggested register for each synth sound, used to place hummed lines in the right octave. */
export const SOUND_CENTER: Record<string, number> = {
  bass: 40, // E2
  sub: 36, // C2
  lead: 72, // C5
  pluck: 67,
  keys: 64,
  pad: 60,
}
