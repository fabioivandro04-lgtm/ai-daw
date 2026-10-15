/**
 * Imported audio files live in IndexedDB (localStorage is too small for audio);
 * the project only stores their id. Decoded buffers are cached in memory and
 * shared by live playback and offline rendering.
 */

const DB = 'ai-daw'
const STORE = 'samples'
const decoded = new Map<string, AudioBuffer>()

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Decodes and stores a file. Throws if the browser cannot decode it. */
export async function importSample(file: File, ctx: BaseAudioContext): Promise<{ id: string; name: string }> {
  const data = await file.arrayBuffer()
  const buffer = await ctx.decodeAudioData(data.slice(0))
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await tx('readwrite', (s) => s.put(data, id))
  decoded.set(id, buffer)
  return { id, name: file.name.replace(/\.[^.]+$/, '') }
}

/** Loads every sample a project uses into the cache. Missing ones are skipped. */
export async function loadSamples(ids: string[], ctx: BaseAudioContext): Promise<void> {
  await Promise.all(
    ids
      .filter((id) => !decoded.has(id))
      .map(async (id) => {
        const data = await tx<ArrayBuffer | undefined>('readonly', (s) => s.get(id)).catch(() => undefined)
        if (data) decoded.set(id, await ctx.decodeAudioData(data.slice(0)))
      }),
  )
}

export function getSample(id: string | undefined): AudioBuffer | undefined {
  return id ? decoded.get(id) : undefined
}

export function playSample(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, t: number, pitch: number, vel: number) {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = Math.pow(2, (pitch - 60) / 12)
  const g = ctx.createGain()
  g.gain.value = vel
  src.connect(g).connect(out)
  src.start(t)
}
