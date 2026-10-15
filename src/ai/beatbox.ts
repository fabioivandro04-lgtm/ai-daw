import { stepDuration } from '../core/music'
import { powerSpectrum, rms } from './dsp'

/**
 * Beatbox → drum pattern.
 * Finds each hit from the energy envelope, then classifies it by where its
 * energy sits in the spectrum: "boom" → kick, "ts" → hat, "k"/"pf" → snare.
 */

export type BeatboxSound = 'kick' | 'snare' | 'hat'

export interface DetectedHit {
  time: number
  sound: BeatboxSound
  velocity: number
  features: { centroid: number; low: number; high: number }
}

const MIN_GAP_S = 0.07

export function detectOnsets(x: Float32Array, sampleRate: number): { time: number; level: number }[] {
  const hop = Math.round(sampleRate * 0.005)
  const win = hop * 2
  const env: number[] = []
  for (let off = 0; off + win <= x.length; off += hop) env.push(rms(x, off, off + win))
  const max = Math.max(1e-9, ...env)
  const gate = Math.max(0.01, max * 0.12)
  const onsets: { time: number; level: number }[] = []
  let lastTime = -Infinity
  for (let i = 1; i < env.length; i++) {
    const time = (i * hop) / sampleRate
    if (env[i] < gate || time - lastTime < MIN_GAP_S) continue
    const before = Math.min(...env.slice(Math.max(0, i - 8), i))
    if (env[i] < before * 2.5 + gate * 0.5) continue
    // Find the peak level in the next 30 ms for velocity.
    let peak = env[i]
    for (let k = i; k < Math.min(env.length, i + 6); k++) peak = Math.max(peak, env[k])
    onsets.push({ time, level: peak / max })
    lastTime = time
  }
  return onsets
}

export function spectralFeatures(x: Float32Array, sampleRate: number, start: number) {
  const size = 2048
  const spec = powerSpectrum(x, start, size)
  const binHz = sampleRate / size
  let total = 0
  let weighted = 0
  let low = 0
  let high = 0
  for (let i = 1; i < spec.length; i++) {
    const f = i * binHz
    total += spec[i]
    weighted += spec[i] * f
    if (f < 250) low += spec[i]
    if (f > 4000) high += spec[i]
  }
  if (total === 0) return { centroid: 0, low: 0, high: 0 }
  return { centroid: weighted / total, low: low / total, high: high / total }
}

export function classifyHit(f: { centroid: number; low: number; high: number }): BeatboxSound {
  if (f.low > 0.35 || f.centroid < 500) return 'kick'
  if (f.high > 0.4 || f.centroid > 3500) return 'hat'
  return 'snare'
}

export function detectHits(x: Float32Array, sampleRate: number): DetectedHit[] {
  return detectOnsets(x, sampleRate).map(({ time, level }) => {
    const features = spectralFeatures(x, sampleRate, Math.floor(time * sampleRate))
    return { time, sound: classifyHit(features), velocity: Math.min(1, 0.4 + 0.6 * level), features }
  })
}

export interface QuantizedHits {
  kick: { step: number; velocity: number }[]
  snare: { step: number; velocity: number }[]
  hat: { step: number; velocity: number }[]
}

export function quantizeHits(hits: DetectedHit[], bpm: number, lengthSteps: number, alignFirst: boolean): QuantizedHits {
  const out: QuantizedHits = { kick: [], snare: [], hat: [] }
  if (hits.length === 0) return out
  const sd = stepDuration(bpm)
  const offset = alignFirst ? hits[0].time : 0
  for (const h of hits) {
    const step = Math.round((h.time - offset) / sd)
    if (step < 0 || step >= lengthSteps) continue
    const list = out[h.sound]
    if (!list.some((e) => e.step === step)) list.push({ step, velocity: h.velocity })
  }
  return out
}
