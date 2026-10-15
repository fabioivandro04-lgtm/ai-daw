import { COMMANDS, summarizeProject } from '../core/commands'
import type { Project } from '../core/types'

/**
 * The AI producer. Sends the user's request plus the project state to an
 * OpenRouter model, and executes the tool calls it returns through the same
 * command API the UI uses. Loops until the model stops calling tools.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AgentSettings {
  apiKey: string
  model: string
}

export interface AgentHost {
  getProject: () => Project
  /** Runs a command; throws on invalid input. */
  run: (name: string, args: unknown) => unknown
  play: () => void
  stop: () => void
  onToolCall?: (name: string, args: unknown, result: unknown, error?: string) => void
}

const MAX_ROUNDS = 16
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

const EXTRA_TOOLS = [
  { name: 'play', description: 'Start playback (the current pattern in PAT mode, the whole song in SONG mode).', parameters: { type: 'object', properties: {} } },
  { name: 'stop', description: 'Stop playback.', parameters: { type: 'object', properties: {} } },
]

export const TOOLS = [...COMMANDS, ...EXTRA_TOOLS].map((c) => ({
  type: 'function' as const,
  function: { name: c.name, description: c.description, parameters: c.parameters },
}))

function systemPrompt(project: Project): string {
  return `You are the built-in music producer of a DAW that works like FL Studio. The user describes music in words; you build it by calling tools.

How the DAW is organized:
- Channels (channel rack) are instruments. Drum channels play one sound (use set_drum_steps); synth channels play notes (use add_notes; pitch names like "A1", "C4"; C4 = MIDI 60).
- Patterns hold the notes of every channel. Note tools write to the current pattern unless you pass "pattern". Make one pattern per song section (e.g. "Intro", "Verse", "Drop") with add_pattern, or clone_pattern for variations.
- The playlist arranges patterns into a song: add_clip(pattern, track, bar). Put each pattern on its own track. Then set_song_mode(true) to hear the whole song; set_song_mode(false) loops the current pattern.
- Each channel is routed to its own mixer insert (see "insert" per channel; 0 = Master). Effects live on inserts: add_fx / set_fx (reverb, delay, filter, distortion, eq, compressor, chorus; all values 0-1).
- Automation (set_automation) changes an insert/fx/channel parameter over the song, e.g. a filter sweep into a drop. It plays in SONG mode.

Timing: 16th-note steps. 4 steps = 1 beat, 16 steps = 1 bar. Step 0 is the downbeat of bar 1. Playlist positions are in bars.
Good registers: bass/sub A0-E2, keys/pads C3-C5, leads C4-C6. Stay in the project key unless asked otherwise.
When asked to create something, make it musical and genre-appropriate, fill the pattern (vary the last bar), then call play so the user hears it.
Prefer editing existing channels and patterns over duplicates. Reply in the user's language, in 1-3 short sentences.

Current project:
${JSON.stringify(summarizeProject(project))}`
}

export async function runAgent(
  history: ChatMessage[],
  settings: AgentSettings,
  host: AgentHost,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  if (!settings.apiKey) throw new Error('Add your OpenRouter API key in Settings first.')
  const messages = [...history]

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'AI DAW',
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'system', content: systemPrompt(host.getProject()) }, ...messages],
        tools: TOOLS,
        tool_choice: 'auto',
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = await res.json()
    const msg = data.choices?.[0]?.message
    if (!msg) throw new Error('OpenRouter returned no message')

    // Some providers return content as an array of parts instead of a string.
    const content = Array.isArray(msg.content) ? msg.content.map((p: { text?: string }) => p.text ?? '').join('') : msg.content
    const reply: ChatMessage = { role: 'assistant', content: content || null }
    if (msg.tool_calls?.length) reply.tool_calls = msg.tool_calls
    messages.push(reply)
    if (!reply.tool_calls) return messages

    for (const call of reply.tool_calls) {
      let args: unknown = {}
      let content: string
      try {
        args = JSON.parse(call.function.arguments || '{}')
        let result: unknown
        if (call.function.name === 'play') result = (host.play(), { playing: true })
        else if (call.function.name === 'stop') result = (host.stop(), { playing: false })
        else result = host.run(call.function.name, args)
        host.onToolCall?.(call.function.name, args, result)
        content = JSON.stringify({ ok: true, result })
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        host.onToolCall?.(call.function.name, args, undefined, error)
        content = JSON.stringify({ ok: false, error })
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content })
    }
  }
  messages.push({ role: 'assistant', content: 'Stopped after too many steps. Ask me to continue if needed.' })
  return messages
}

/** Keeps context bounded; the cut must start at a user turn or providers reject orphaned tool results. */
export function trimHistory(messages: ChatMessage[], max = 30): ChatMessage[] {
  const tail = messages.slice(-max)
  const start = tail.findIndex((m) => m.role === 'user')
  return start < 0 ? [] : tail.slice(start)
}
