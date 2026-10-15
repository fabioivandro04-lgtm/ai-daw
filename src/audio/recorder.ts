import { engine } from '.'

export interface Recording {
  samples: Float32Array
  sampleRate: number
}

/**
 * Records the microphone. Browser voice processing is turned off because it
 * distorts pitch and squashes drum transients.
 */
export class MicRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null

  async start() {
    const ctx = await engine.ensure()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    this.source = ctx.createMediaStreamSource(this.stream)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.source.connect(this.analyser)
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.recorder.start()
  }

  /** Current input level 0..1 for a meter. */
  level(): number {
    if (!this.analyser) return 0
    const buf = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    return Math.min(1, peak * 1.5)
  }

  async stop(): Promise<Recording> {
    const rec = this.recorder
    if (!rec) throw new Error('Not recording')
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()))
    rec.stop()
    await done
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.recorder = null
    const ctx = await engine.ensure()
    const audio = await ctx.decodeAudioData(await new Blob(this.chunks).arrayBuffer())
    // Mix down to mono.
    const samples = new Float32Array(audio.length)
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c)
      for (let i = 0; i < d.length; i++) samples[i] += d[i] / audio.numberOfChannels
    }
    return { samples, sampleRate: audio.sampleRate }
  }
}
