import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../core/music'
import { detectHits, quantizeHits } from './beatbox'
import { detectNotes, quantizeNotes } from './pitch'

const SR = 48000

/** A "sung" tone: harmonics plus a little vibrato and a soft attack/release. */
function hum(midi: number, seconds: number, amp = 0.4): Float32Array {
  const f = midiToFreq(midi)
  const n = Math.floor(seconds * SR)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (2 * Math.PI * f * (1 + 0.004 * Math.sin(2 * Math.PI * 5 * t))) / SR
    const env = Math.min(1, t / 0.02, (seconds - t) / 0.02)
    out[i] = amp * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase))
  }
  return out
}

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.floor(seconds * SR))
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// Deterministic noise so tests are stable.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32 - 0.5
  }
}

function kick(): Float32Array {
  const n = Math.floor(0.25 * SR)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (2 * Math.PI * (60 + 90 * Math.exp(-t * 30))) / SR
    out[i] = 0.8 * Math.exp(-t * 12) * Math.sin(phase)
  }
  return out
}

function hat(): Float32Array {
  const r = rng(1)
  const n = Math.floor(0.12 * SR)
  const out = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const w = r()
    out[i] = 0.9 * Math.exp((-i / SR) * 35) * (w - prev) // first difference = high-passed noise
    prev = w
  }
  return out
}

function snare(): Float32Array {
  const r = rng(7)
  const n = Math.floor(0.2 * SR)
  const out = new Float32Array(n)
  // Band-passed noise around 1-2 kHz: two low-pass stages, minus the slow part.
  let a = 0
  let b = 0
  let slow = 0
  for (let i = 0; i < n; i++) {
    a += 0.2 * (r() - a)
    b += 0.2 * (a - b)
    slow += 0.03 * (b - slow)
    out[i] = 6 * Math.exp((-i / SR) * 18) * (b - slow)
  }
  return out
}

describe('hum to notes', () => {
  it('detects a simple hummed melody', () => {
    const audio = concat(silence(0.2), hum(57, 0.4), silence(0.1), hum(64, 0.4), silence(0.1), hum(60, 0.6), silence(0.2))
    const notes = detectNotes(audio, SR)
    expect(notes.map((n) => n.midi)).toEqual([57, 64, 60])
    expect(notes[0].time).toBeGreaterThan(0.15)
    expect(notes[0].time).toBeLessThan(0.25)
    expect(notes[2].duration).toBeGreaterThan(0.5)
  })

  it('splits notes on a pitch change without a gap', () => {
    const notes = detectNotes(concat(silence(0.1), hum(48, 0.4), hum(52, 0.4), silence(0.1)), SR)
    expect(notes.map((n) => n.midi)).toEqual([48, 52])
  })

  it('quantizes to the grid, key and target octave', () => {
    // At 120 BPM a 16th note is 0.125 s.
    const q = quantizeNotes(
      [
        { midi: 61, time: 1.0, duration: 0.24, velocity: 1 }, // C#4, off-key in A minor
        { midi: 64, time: 1.26, duration: 0.5, velocity: 1 },
      ],
      { bpm: 120, lengthSteps: 32, keyRoot: 9, scale: 'minor', snapToKey: true, targetCenter: 40, alignFirst: true },
    )
    expect(q).toEqual([
      { pitch: 36, start: 0, length: 2, velocity: 1 }, // snapped C, moved 2 octaves down
      { pitch: 40, start: 2, length: 4, velocity: 1 },
    ])
  })
})

describe('beatbox to drums', () => {
  it('classifies kick, hat and snare sounds', () => {
    const audio = concat(silence(0.1), kick(), silence(0.1), hat(), silence(0.1), snare(), silence(0.2))
    const hits = detectHits(audio, SR)
    expect(hits.map((h) => h.sound)).toEqual(['kick', 'hat', 'snare'])
  })

  it('quantizes a boom-ts-pf-ts groove onto steps', () => {
    // 120 BPM: one 8th note = 0.25 s
    const gap = (len: number) => silence(0.25 - len / SR)
    const k = kick()
    const h = hat()
    const s = snare()
    const audio = concat(silence(0.1), k, gap(k.length), h, gap(h.length), s, gap(s.length), h, silence(0.3))
    const q = quantizeHits(detectHits(audio, SR), 120, 16, true)
    expect(q.kick.map((e) => e.step)).toEqual([0])
    expect(q.hat.map((e) => e.step)).toEqual([2, 6])
    expect(q.snare.map((e) => e.step)).toEqual([4])
  })
})
