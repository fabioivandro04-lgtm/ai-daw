/**
 * Talk to the DAW using the browser's built-in speech recognition
 * (Chrome, Edge, Safari). shortcut: browser-only STT, swap for Whisper if
 * Firefox support or offline use is needed.
 */

interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

export function speechSupported(): boolean {
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

/** Starts listening. Calls onText with live text, then onDone with the final text. Returns a stop function. */
export function listen(onText: (text: string) => void, onDone: (text: string) => void, onError: (msg: string) => void): () => void {
  const w = window as unknown as Record<string, new () => RecognitionLike>
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  const rec = new Ctor()
  rec.lang = navigator.language || 'en-US'
  rec.interimResults = true
  rec.continuous = false
  let text = ''
  rec.onresult = (e) => {
    text = Array.from(e.results, (r) => r[0].transcript).join(' ')
    onText(text)
  }
  rec.onerror = (e) => onError(e.error === 'not-allowed' ? 'Microphone permission denied' : `Speech error: ${e.error}`)
  rec.onend = () => onDone(text)
  rec.start()
  return () => rec.stop()
}
