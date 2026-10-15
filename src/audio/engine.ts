import { currentPattern, songBars } from '../core/commands'
import { stepDuration } from '../core/music'
import { STEPS_PER_BAR, type Channel, type DrumSound, type Pattern, type Project, type SynthSound } from '../core/types'
import { createFx, type FxUnit } from './fx'
import { playDrum, playSynth } from './instruments'
import { getSample, playSample } from './samples'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.12

interface InsertNodes {
  input: GainNode
  fx: FxUnit[]
  sig: string
  fader: GainNode
  pan: StereoPannerNode
  meter: AnalyserNode
}

interface ChannelNodes {
  gain: GainNode
  pan: StereoPannerNode
  insert: number
}

/** The mixer: channel strips → inserts (FX chain, fader, pan) → master → output. */
class Graph {
  inserts: InsertNodes[] = []
  channels = new Map<string, ChannelNodes>()
  private ctx: BaseAudioContext
  private out: AudioNode
  private bpm = 120

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx
    this.out = out
  }

  private insertNodes(i: number): InsertNodes {
    let ins = this.inserts[i]
    if (ins) return ins
    const { ctx } = this
    const input = ctx.createGain()
    const fader = ctx.createGain()
    const pan = ctx.createStereoPanner()
    const meter = ctx.createAnalyser()
    meter.fftSize = 512
    input.connect(fader)
    fader.connect(pan).connect(meter)
    meter.connect(i === 0 ? this.out : this.insertNodes(0).input)
    ins = { input, fx: [], sig: '', fader, pan, meter }
    this.inserts[i] = ins
    return ins
  }

  sync(p: Project) {
    const t = this.ctx.currentTime
    this.bpm = p.bpm
    const anySolo = p.mixer.some((m, i) => i > 0 && m.solo)
    p.mixer.forEach((m, i) => {
      const ins = this.insertNodes(i)
      const sig = m.fx.map((f) => f.id).join(',')
      if (sig !== ins.sig) {
        // Rebuild the chain only when slots are added, removed or reordered.
        ins.input.disconnect()
        ins.fx.forEach((u) => u.dispose())
        ins.fx = m.fx.map((f) => createFx(this.ctx, f, () => this.bpm))
        const chain = [ins.input, ...ins.fx.flatMap((u) => [u.input, u.output]), ins.fader]
        for (let k = 0; k < chain.length - 1; k += 2) chain[k].connect(chain[k + 1])
        ins.sig = sig
      }
      m.fx.forEach((f, k) => {
        for (const [name, v] of Object.entries(f.params)) ins.fx[k].set(name, v, t)
        ins.fx[k].setOn(f.on, f.mix, t)
      })
      const audible = !m.mute && (i === 0 || !anySolo || m.solo)
      ins.fader.gain.setTargetAtTime(audible ? m.volume * m.volume : 0, t, 0.01)
      ins.pan.pan.setTargetAtTime(m.pan, t, 0.01)
    })
    const live = new Set<string>()
    for (const c of p.channels) {
      live.add(c.id)
      let ch = this.channels.get(c.id)
      if (!ch) {
        const gain = this.ctx.createGain()
        const pan = this.ctx.createStereoPanner()
        gain.connect(pan)
        ch = { gain, pan, insert: -1 }
        this.channels.set(c.id, ch)
      }
      if (ch.insert !== c.insert) {
        ch.pan.disconnect()
        ch.pan.connect(this.insertNodes(c.insert).input)
        ch.insert = c.insert
      }
      ch.gain.gain.setTargetAtTime(c.mute ? 0 : c.volume * c.volume, t, 0.01)
      ch.pan.pan.setTargetAtTime(c.pan, t, 0.01)
    }
    for (const [id, ch] of this.channels) {
      if (!live.has(id)) {
        ch.pan.disconnect()
        this.channels.delete(id)
      }
    }
  }

  playNote(c: Channel, t: number, pitch: number, seconds: number, vel: number) {
    const out = this.channels.get(c.id)?.gain
    if (!out) return
    if (c.type === 'drum') playDrum(this.ctx, out, c.sound as DrumSound, t, vel)
    else if (c.type === 'synth') playSynth(this.ctx, out, c.sound as SynthSound, t, pitch, seconds, vel)
    else {
      const buf = getSample(c.sampleId)
      if (buf) playSample(this.ctx, out, buf, t, pitch, vel)
    }
  }

  scheduleStep(p: Project, pattern: Pattern, step: number, time: number) {
    const sd = stepDuration(p.bpm)
    const swing = step % 2 === 1 ? p.swing * 0.5 * sd : 0 // swing delays every second 16th
    for (const c of p.channels) {
      for (const n of pattern.notes[c.id] ?? []) {
        if (Math.floor(n.start) === step) this.playNote(c, time + (n.start - step) * sd + swing, n.pitch, n.length * sd, n.velocity)
      }
    }
  }

  /** Sets every automated parameter to its value at `songStep`. */
  automate(p: Project, songStep: number, t: number) {
    for (const lane of p.automation) {
      const v = valueAt(lane.points, songStep)
      if (v === null) continue
      const [kind, ref, what, slot, param] = lane.target.split(':')
      if (kind === 'insert') {
        const ins = this.inserts[Number(ref)]
        if (!ins) continue
        if (what === 'volume') ins.fader.gain.setTargetAtTime((v * 1.25) ** 2, t, 0.01)
        else if (what === 'pan') ins.pan.pan.setTargetAtTime(v * 2 - 1, t, 0.01)
        else if (what === 'fx') ins.fx[Number(slot)]?.set(param, v, t)
      } else {
        const ch = this.channels.get(ref)
        if (!ch) continue
        if (what === 'volume') ch.gain.gain.setTargetAtTime(v * v, t, 0.01)
        else ch.pan.pan.setTargetAtTime(v * 2 - 1, t, 0.01)
      }
    }
  }

  level(i: number): number {
    const m = this.inserts[i]?.meter
    if (!m) return 0
    const buf = new Float32Array(m.fftSize)
    m.getFloatTimeDomainData(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    return peak
  }
}

export function valueAt(points: { t: number; v: number }[], step: number): number | null {
  if (!points.length) return null
  if (step <= points[0].t) return points[0].v
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (step <= b.t) return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (step - a.t)) / (b.t - a.t)
  }
  return points[points.length - 1].v
}

/** Which pattern steps sound at a song step: one entry per playlist clip covering it. */
export function songStepEvents(p: Project, songStep: number): { pattern: Pattern; step: number }[] {
  const out: { pattern: Pattern; step: number }[] = []
  for (const clip of p.playlist) {
    const from = Math.round(clip.start * STEPS_PER_BAR)
    const to = Math.round((clip.start + clip.length) * STEPS_PER_BAR)
    if (songStep < from || songStep >= to) continue
    const pattern = p.patterns.find((x) => x.id === clip.patternId)
    if (pattern) out.push({ pattern, step: (songStep - from) % pattern.lengthSteps })
  }
  return out
}

export interface Position {
  songStep: number | null
  patternStep: number | null // step of the current pattern, when it is sounding
}

type Listener = (pos: Position | null) => void

export class AudioEngine {
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private nextStep = 0
  private nextStepTime = 0
  private listeners = new Set<Listener>()
  private getProject: () => Project
  playing = false
  analyser: AnalyserNode | null = null

  constructor(getProject: () => Project) {
    this.getProject = getProject
  }

  /** Must be called from a user gesture the first time (browser autoplay rules). */
  async ensure(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.connect(this.ctx.destination)
      this.graph = new Graph(this.ctx, this.analyser)
      this.graph.sync(this.getProject())
    }
    if (this.ctx.state !== 'running') await this.ctx.resume()
    return this.ctx
  }

  sync(project: Project) {
    this.graph?.sync(project)
  }

  level(insert: number): number {
    return this.graph?.level(insert) ?? 0
  }

  onPosition(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(pos: Position | null) {
    for (const fn of this.listeners) fn(pos)
  }

  async play(fromSongStep = 0) {
    const ctx = await this.ensure()
    if (this.playing) this.stop()
    this.playing = true
    this.nextStep = fromSongStep
    this.nextStepTime = ctx.currentTime + 0.05
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS)
    this.tick()
  }

  stop() {
    this.playing = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.graph?.sync(this.getProject()) // drop automation values back to the mixer settings
    this.emit(null)
  }

  private tick() {
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph) return
    const p = this.getProject()
    const cur = currentPattern(p)
    while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      let pos: Position
      if (p.songMode) {
        const step = this.nextStep % (songBars(p) * STEPS_PER_BAR)
        const events = songStepEvents(p, step)
        for (const e of events) graph.scheduleStep(p, e.pattern, e.step, this.nextStepTime)
        graph.automate(p, step, this.nextStepTime)
        pos = { songStep: step, patternStep: events.find((e) => e.pattern.id === cur.id)?.step ?? null }
        this.nextStep = step + 1
      } else {
        const step = this.nextStep % cur.lengthSteps
        graph.scheduleStep(p, cur, step, this.nextStepTime)
        pos = { songStep: null, patternStep: step }
        this.nextStep = step + 1
      }
      const delay = Math.max(0, (this.nextStepTime - ctx.currentTime) * 1000)
      setTimeout(() => this.playing && this.emit(pos), delay)
      this.nextStepTime += stepDuration(p.bpm)
    }
  }

  /** Plays one sound immediately, e.g. when clicking a piano key. */
  async preview(channel: Channel, pitch = 60) {
    const ctx = await this.ensure()
    this.graph?.playNote(channel, ctx.currentTime + 0.005, pitch, 0.25, 0.8)
  }
}

/** Renders the song (SONG mode) or two loops of the current pattern (PAT mode), with a short tail. */
export async function renderProject(p: Project, sampleRate = 44100): Promise<AudioBuffer> {
  const sd = stepDuration(p.bpm)
  const cur = currentPattern(p)
  const steps = p.songMode ? songBars(p) * STEPS_PER_BAR : cur.lengthSteps * 2
  const ctx = new OfflineAudioContext(2, Math.ceil((steps * sd + 3) * sampleRate), sampleRate)
  const graph = new Graph(ctx, ctx.destination)
  graph.sync(p)
  for (let i = 0; i < steps; i++) {
    if (p.songMode) {
      for (const e of songStepEvents(p, i)) graph.scheduleStep(p, e.pattern, e.step, i * sd)
      graph.automate(p, i, i * sd)
    } else graph.scheduleStep(p, cur, i % cur.lengthSteps, i * sd)
  }
  return ctx.startRendering()
}
