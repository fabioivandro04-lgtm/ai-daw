import { stepDuration } from '../core/music'
import type { Channel, DrumSound, Project, SynthSound } from '../core/types'
import { playDrum, playSynth } from './instruments'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.12

interface MixerStrip {
  gain: GainNode
  pan: StereoPannerNode
}

interface Graph {
  master: GainNode
  strips: Map<string, MixerStrip>
}

function audible(c: Channel, anySolo: boolean): boolean {
  return !c.mute && (!anySolo || c.solo)
}

function buildGraph(ctx: BaseAudioContext, project: Project, out: AudioNode): Graph {
  const master = ctx.createGain()
  master.gain.value = project.masterVolume
  master.connect(out)
  const graph: Graph = { master, strips: new Map() }
  syncGraph(ctx, graph, project)
  return graph
}

function syncGraph(ctx: BaseAudioContext, graph: Graph, project: Project) {
  const anySolo = project.channels.some((c) => c.solo)
  const now = ctx.currentTime
  graph.master.gain.setTargetAtTime(project.masterVolume, now, 0.01)
  const live = new Set<string>()
  for (const c of project.channels) {
    live.add(c.id)
    let strip = graph.strips.get(c.id)
    if (!strip) {
      const gain = ctx.createGain()
      const pan = ctx.createStereoPanner()
      gain.connect(pan).connect(graph.master)
      strip = { gain, pan }
      graph.strips.set(c.id, strip)
    }
    const vol = audible(c, anySolo) ? c.volume * c.volume : 0 // squared = more natural fader curve
    strip.gain.gain.setTargetAtTime(vol, now, 0.01)
    strip.pan.pan.setTargetAtTime(c.pan, now, 0.01)
  }
  for (const [id, strip] of graph.strips) {
    if (!live.has(id)) {
      strip.pan.disconnect()
      graph.strips.delete(id)
    }
  }
}

function stepTimeOffset(project: Project, step: number): number {
  // Swing delays every second 16th by up to half a step.
  return step % 2 === 1 ? project.swing * 0.5 * stepDuration(project.bpm) : 0
}

function scheduleStep(ctx: BaseAudioContext, graph: Graph, project: Project, step: number, time: number) {
  const sd = stepDuration(project.bpm)
  for (const c of project.channels) {
    const strip = graph.strips.get(c.id)
    if (!strip) continue
    for (const n of c.notes) {
      if (Math.floor(n.start) !== step) continue
      const t = time + (n.start - step) * sd + stepTimeOffset(project, step)
      if (c.type === 'drum') playDrum(ctx, strip.gain, c.sound as DrumSound, t, n.velocity)
      else playSynth(ctx, strip.gain, c.sound as SynthSound, t, n.pitch, n.length * sd, n.velocity)
    }
  }
}

type StepListener = (step: number | null) => void

export class AudioEngine {
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private nextStep = 0
  private nextStepTime = 0
  private listeners = new Set<StepListener>()
  analyser: AnalyserNode | null = null
  playing = false

  private getProject: () => Project

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
      this.graph = buildGraph(this.ctx, this.getProject(), this.analyser)
    }
    if (this.ctx.state !== 'running') await this.ctx.resume()
    return this.ctx
  }

  sync(project: Project) {
    if (this.ctx && this.graph) syncGraph(this.ctx, this.graph, project)
  }

  onStep(fn: StepListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(step: number | null) {
    for (const fn of this.listeners) fn(step)
  }

  async play() {
    const ctx = await this.ensure()
    if (this.playing) return
    this.playing = true
    this.nextStep = 0
    this.nextStepTime = ctx.currentTime + 0.05
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS)
    this.tick()
  }

  stop() {
    this.playing = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.emit(null)
  }

  private tick() {
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph) return
    const project = this.getProject()
    while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const step = this.nextStep % project.lengthSteps
      scheduleStep(ctx, graph, project, step, this.nextStepTime)
      const delay = Math.max(0, (this.nextStepTime - ctx.currentTime) * 1000)
      setTimeout(() => this.playing && this.emit(step), delay)
      this.nextStepTime += stepDuration(project.bpm)
      this.nextStep = step + 1
    }
  }

  /** Plays one sound immediately, e.g. when clicking a piano key. */
  async preview(channel: Channel, pitch = 60) {
    const ctx = await this.ensure()
    const strip = this.graph?.strips.get(channel.id)
    if (!strip) return
    const t = ctx.currentTime + 0.005
    if (channel.type === 'drum') playDrum(ctx, strip.gain, channel.sound as DrumSound, t, 0.85)
    else playSynth(ctx, strip.gain, channel.sound as SynthSound, t, pitch, 0.25, 0.8)
  }
}

/** Renders the pattern `loops` times into an AudioBuffer (with a short tail). */
export async function renderProject(project: Project, loops = 2, sampleRate = 44100): Promise<AudioBuffer> {
  const sd = stepDuration(project.bpm)
  const seconds = project.lengthSteps * loops * sd + 2
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate)
  const graph = buildGraph(ctx, project, ctx.destination)
  for (let i = 0; i < project.lengthSteps * loops; i++) {
    scheduleStep(ctx, graph, project, i % project.lengthSteps, i * sd)
  }
  return ctx.startRendering()
}
