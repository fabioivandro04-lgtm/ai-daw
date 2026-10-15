import { midiToFreq } from '../core/music'
import type { DrumSound, SynthSound } from '../core/types'

/**
 * Synthesized instruments. Each voice takes any BaseAudioContext so the same
 * code drives live playback and offline WAV rendering.
 */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx)
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, buf)
  }
  return buf
}

function env(ctx: BaseAudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  g.connect(out)
  return g
}

function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  filterType: BiquadFilterType,
  freq: number,
  q: number,
  peak: number,
  decay: number,
) {
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx)
  const f = ctx.createBiquadFilter()
  f.type = filterType
  f.frequency.value = freq
  f.Q.value = q
  src.connect(f).connect(env(ctx, out, t, peak, 0.001, decay))
  src.start(t, Math.random())
  src.stop(t + decay + 0.05)
}

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  sweep: number,
  peak: number,
  decay: number,
) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  o.frequency.exponentialRampToValueAtTime(f1, t + sweep)
  o.connect(env(ctx, out, t, peak, 0.002, decay))
  o.start(t)
  o.stop(t + decay + 0.05)
}

export function playDrum(ctx: BaseAudioContext, out: AudioNode, sound: DrumSound, t: number, vel: number) {
  switch (sound) {
    case 'kick':
      tone(ctx, out, t, 'sine', 160, 42, 0.12, vel, 0.45)
      tone(ctx, out, t, 'triangle', 900, 120, 0.02, vel * 0.25, 0.03)
      break
    case 'snare':
      tone(ctx, out, t, 'triangle', 220, 160, 0.05, vel * 0.5, 0.12)
      noiseBurst(ctx, out, t, 'bandpass', 3000, 0.7, vel * 0.8, 0.18)
      break
    case 'clap':
      for (const dt of [0, 0.011, 0.022]) noiseBurst(ctx, out, t + dt, 'bandpass', 1400, 1.5, vel * 0.7, 0.02)
      noiseBurst(ctx, out, t + 0.03, 'bandpass', 1300, 1.2, vel * 0.8, 0.2)
      break
    case 'hat':
      noiseBurst(ctx, out, t, 'highpass', 7500, 0.8, vel * 0.45, 0.05)
      break
    case 'openhat':
      noiseBurst(ctx, out, t, 'highpass', 7000, 0.8, vel * 0.4, 0.35)
      break
    case 'tom':
      tone(ctx, out, t, 'sine', 220, 110, 0.2, vel * 0.9, 0.35)
      break
    case 'rim':
      tone(ctx, out, t, 'square', 1700, 1600, 0.01, vel * 0.3, 0.03)
      noiseBurst(ctx, out, t, 'bandpass', 2500, 4, vel * 0.3, 0.02)
      break
    case 'crash':
      noiseBurst(ctx, out, t, 'highpass', 5000, 0.5, vel * 0.4, 1.6)
      noiseBurst(ctx, out, t, 'bandpass', 9000, 1, vel * 0.2, 1.0)
      break
  }
}

interface SynthPatch {
  oscs: { type: OscillatorType; detune: number; octave: number; gain: number }[]
  cutoff: number
  envAmount: number // filter envelope in Hz added on top of cutoff
  filterDecay: number
  q: number
  attack: number
  release: number
  sustain: number // 0..1
}

const PATCHES: Record<SynthSound, SynthPatch> = {
  bass: {
    oscs: [
      { type: 'sawtooth', detune: 0, octave: 0, gain: 0.5 },
      { type: 'square', detune: 0, octave: -1, gain: 0.35 },
    ],
    cutoff: 220,
    envAmount: 1400,
    filterDecay: 0.18,
    q: 6,
    attack: 0.004,
    release: 0.08,
    sustain: 0.8,
  },
  sub: {
    oscs: [{ type: 'sine', detune: 0, octave: 0, gain: 0.9 }],
    cutoff: 800,
    envAmount: 0,
    filterDecay: 0.1,
    q: 0,
    attack: 0.005,
    release: 0.08,
    sustain: 1,
  },
  lead: {
    oscs: [
      { type: 'sawtooth', detune: -9, octave: 0, gain: 0.35 },
      { type: 'sawtooth', detune: 9, octave: 0, gain: 0.35 },
      { type: 'square', detune: 0, octave: 1, gain: 0.1 },
    ],
    cutoff: 1600,
    envAmount: 2500,
    filterDecay: 0.25,
    q: 3,
    attack: 0.008,
    release: 0.15,
    sustain: 0.75,
  },
  pad: {
    oscs: [
      { type: 'sawtooth', detune: -14, octave: 0, gain: 0.25 },
      { type: 'sawtooth', detune: 0, octave: 0, gain: 0.25 },
      { type: 'sawtooth', detune: 14, octave: 0, gain: 0.25 },
    ],
    cutoff: 1100,
    envAmount: 600,
    filterDecay: 1.2,
    q: 1,
    attack: 0.35,
    release: 0.8,
    sustain: 0.9,
  },
  pluck: {
    oscs: [
      { type: 'square', detune: 0, octave: 0, gain: 0.3 },
      { type: 'triangle', detune: 5, octave: 1, gain: 0.25 },
    ],
    cutoff: 500,
    envAmount: 4000,
    filterDecay: 0.12,
    q: 4,
    attack: 0.002,
    release: 0.12,
    sustain: 0.15,
  },
  keys: {
    oscs: [
      { type: 'triangle', detune: 0, octave: 0, gain: 0.5 },
      { type: 'sine', detune: 0, octave: 1, gain: 0.2 },
      { type: 'sine', detune: 3, octave: 2, gain: 0.06 },
    ],
    cutoff: 2500,
    envAmount: 1500,
    filterDecay: 0.5,
    q: 0.5,
    attack: 0.004,
    release: 0.3,
    sustain: 0.45,
  },
}

export function playSynth(
  ctx: BaseAudioContext,
  out: AudioNode,
  sound: SynthSound,
  t: number,
  midi: number,
  duration: number,
  vel: number,
) {
  const p = PATCHES[sound]
  const freq = midiToFreq(midi)
  const end = t + Math.max(duration, p.attack + 0.01)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = p.q
  filter.frequency.setValueAtTime(p.cutoff + p.envAmount, t)
  filter.frequency.exponentialRampToValueAtTime(Math.max(p.cutoff, 30), t + p.filterDecay)

  const amp = ctx.createGain()
  const peak = 0.5 * vel
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.exponentialRampToValueAtTime(peak, t + p.attack)
  amp.gain.exponentialRampToValueAtTime(Math.max(peak * p.sustain, 0.0002), t + p.attack + 0.15)
  amp.gain.setValueAtTime(Math.max(peak * p.sustain, 0.0002), end)
  amp.gain.exponentialRampToValueAtTime(0.0001, end + p.release)

  filter.connect(amp).connect(out)
  for (const o of p.oscs) {
    const osc = ctx.createOscillator()
    osc.type = o.type
    osc.frequency.value = freq * Math.pow(2, o.octave)
    osc.detune.value = o.detune
    const g = ctx.createGain()
    g.gain.value = o.gain
    osc.connect(g).connect(filter)
    osc.start(t)
    osc.stop(end + p.release + 0.05)
  }
}
