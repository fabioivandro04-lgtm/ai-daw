import { stepDuration } from '../core/music'
import type { FxSlot, FxType } from '../core/types'

/**
 * One mixer FX slot: input → dry ─┐
 *                     input → effect → wet ─┴→ output
 * All parameters arrive normalized 0..1 and are mapped to real units here.
 */
export interface FxUnit {
  type: FxType
  input: GainNode
  output: GainNode
  /** Apply one parameter (or "mix") at a time, used by both the mixer and automation. */
  set: (name: string, v: number, time: number) => void
  setOn: (on: boolean, mix: number, time: number) => void
  dispose: () => void
}

const DELAY_STEPS = [1, 2, 3, 4, 6, 8]

function impulse(ctx: BaseAudioContext, size: number, damp: number): AudioBuffer {
  const seconds = 0.3 + size * 3.7
  const len = Math.floor(seconds * ctx.sampleRate)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  const smooth = 0.05 + damp * 0.9 // higher damp = darker tail
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let lp = 0
    for (let i = 0; i < len; i++) {
      lp += (1 - smooth) * ((Math.random() * 2 - 1) - lp)
      d[i] = lp * Math.pow(1 - i / len, 2.5)
    }
  }
  return buf
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 120
  const n = 2048
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

const ramp = (p: AudioParam, v: number, t: number) => p.setTargetAtTime(v, t, 0.015)

export function createFx(ctx: BaseAudioContext, slot: FxSlot, bpm: () => number): FxUnit {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  input.connect(dry).connect(output)
  wet.connect(output)
  const nodes: AudioNode[] = [input, output, dry, wet]
  const keep = <T extends AudioNode>(n: T) => (nodes.push(n), n)
  let params = { ...slot.params }
  let set: (name: string, v: number, t: number) => void

  switch (slot.type) {
    case 'reverb': {
      const conv = keep(ctx.createConvolver())
      input.connect(conv).connect(wet)
      let built = ''
      set = (name, v, _t) => {
        params = { ...params, [name]: v }
        const key = `${params.size.toFixed(2)}:${params.damp.toFixed(2)}`
        if (key !== built) {
          built = key
          conv.buffer = impulse(ctx, params.size, params.damp)
        }
      }
      break
    }
    case 'delay': {
      const delay = keep(ctx.createDelay(4))
      const fb = keep(ctx.createGain())
      const tone = keep(ctx.createBiquadFilter())
      tone.frequency.value = 5000
      input.connect(delay).connect(tone).connect(wet)
      tone.connect(fb).connect(delay)
      set = (name, v, t) => {
        if (name === 'time') ramp(delay.delayTime, DELAY_STEPS[Math.round(v * (DELAY_STEPS.length - 1))] * stepDuration(bpm()), t)
        if (name === 'feedback') ramp(fb.gain, v * 0.9, t)
      }
      break
    }
    case 'filter': {
      const f = keep(ctx.createBiquadFilter())
      input.connect(f).connect(wet)
      set = (name, v, t) => {
        if (name === 'cutoff') ramp(f.frequency, 20 * Math.pow(1000, v), t)
        if (name === 'resonance') ramp(f.Q, 0.5 + v * 19.5, t)
        if (name === 'mode') f.type = v < 0.34 ? 'lowpass' : v < 0.67 ? 'highpass' : 'bandpass'
      }
      break
    }
    case 'distortion': {
      const pre = keep(ctx.createGain())
      const shaper = keep(ctx.createWaveShaper())
      const tone = keep(ctx.createBiquadFilter())
      shaper.oversample = '4x'
      input.connect(pre).connect(shaper).connect(tone).connect(wet)
      set = (name, v, t) => {
        if (name === 'drive' && v !== params.drive) {
          params = { ...params, drive: v }
          shaper.curve = driveCurve(v)
          ramp(pre.gain, 1 + v * 2, t)
        }
        if (name === 'tone') ramp(tone.frequency, 800 * Math.pow(20, v), t)
      }
      break
    }
    case 'eq': {
      const low = keep(ctx.createBiquadFilter())
      const mid = keep(ctx.createBiquadFilter())
      const high = keep(ctx.createBiquadFilter())
      low.type = 'lowshelf'
      low.frequency.value = 200
      mid.type = 'peaking'
      mid.frequency.value = 1000
      mid.Q.value = 0.8
      high.type = 'highshelf'
      high.frequency.value = 5000
      input.connect(low).connect(mid).connect(high).connect(wet)
      const bands: Record<string, BiquadFilterNode> = { low, mid, high }
      set = (name, v, t) => bands[name] && ramp(bands[name].gain, (v - 0.5) * 30, t)
      break
    }
    case 'compressor': {
      const comp = keep(ctx.createDynamicsCompressor())
      const makeup = keep(ctx.createGain())
      input.connect(comp).connect(makeup).connect(wet)
      set = (name, v, t) => {
        if (name === 'threshold') ramp(comp.threshold, -60 + v * 60, t)
        if (name === 'ratio') ramp(comp.ratio, 1 + v * 19, t)
        if (name === 'makeup') ramp(makeup.gain, Math.pow(10, (v * 18) / 20), t)
      }
      break
    }
    case 'chorus': {
      const d = keep(ctx.createDelay(0.1))
      const lfo = keep(ctx.createOscillator())
      const depth = keep(ctx.createGain())
      d.delayTime.value = 0.015
      lfo.connect(depth).connect(d.delayTime)
      lfo.start()
      input.connect(d).connect(wet)
      set = (name, v, t) => {
        if (name === 'rate') ramp(lfo.frequency, 0.1 + v * 4.9, t)
        if (name === 'depth') ramp(depth.gain, v * 0.008, t)
      }
      break
    }
  }

  const setOn = (on: boolean, mix: number, t: number) => {
    ramp(dry.gain, on ? 1 - mix : 1, t)
    ramp(wet.gain, on ? mix : 0, t)
  }

  const unit: FxUnit = {
    type: slot.type,
    input,
    output,
    set: (name, v, t) => {
      if (name !== 'mix') return set(name, v, t)
      ramp(wet.gain, v, t)
      ramp(dry.gain, 1 - v, t)
    },
    setOn,
    dispose: () => {
      for (const n of nodes) {
        n.disconnect()
        if (n instanceof OscillatorNode) n.stop()
      }
    },
  }
  if (slot.type === 'distortion') params = { ...params, drive: -1 }
  for (const [k, v] of Object.entries(slot.params)) unit.set(k, v, 0)
  setOn(slot.on, slot.mix, 0)
  return unit
}
