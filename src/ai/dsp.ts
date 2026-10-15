/** Small DSP helpers shared by the voice analyzers. Pure functions, no Web Audio. */

export function rms(x: Float32Array, start = 0, end = x.length): number {
  let s = 0
  const e = Math.min(end, x.length)
  for (let i = start; i < e; i++) s += x[i] * x[i]
  return e > start ? Math.sqrt(s / (e - start)) : 0
}

/** Integer-factor decimation with a boxcar pre-filter. Good enough for voice pitch tracking. */
export function downsample(x: Float32Array, sampleRate: number, target: number): { data: Float32Array; sampleRate: number } {
  const factor = Math.max(1, Math.floor(sampleRate / target))
  if (factor === 1) return { data: x, sampleRate }
  const out = new Float32Array(Math.floor(x.length / factor))
  for (let i = 0; i < out.length; i++) {
    let s = 0
    for (let j = 0; j < factor; j++) s += x[i * factor + j]
    out[i] = s / factor
  }
  return { data: out, sampleRate: sampleRate / factor }
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** In-place iterative radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Power spectrum of a Hann-windowed slice, zero-padded to `size` (power of two). */
export function powerSpectrum(x: Float32Array, start: number, size: number): Float64Array {
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  const len = Math.min(size, x.length - start)
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1 || 1))
    re[i] = x[start + i] * w
  }
  fft(re, im)
  const out = new Float64Array(size / 2)
  for (let i = 0; i < out.length; i++) out[i] = re[i] * re[i] + im[i] * im[i]
  return out
}
