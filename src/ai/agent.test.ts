import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCommand, demoProject } from '../core/commands'
import type { Project } from '../core/types'
import { runAgent } from './agent'

function reply(message: unknown) {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
}

afterEach(() => vi.unstubAllGlobals())

describe('runAgent', () => {
  it('executes tool calls, reports errors back, and stops on a text reply', async () => {
    let project: Project = demoProject()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          content: null,
          tool_calls: [
            { id: 'a', type: 'function', function: { name: 'set_tempo', arguments: '{"bpm":140}' } },
            { id: 'b', type: 'function', function: { name: 'add_notes', arguments: '{"channel":"Nope","notes":[]}' } },
            { id: 'c', type: 'function', function: { name: 'play', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(reply({ content: 'Done: 140 BPM.' }))
    vi.stubGlobal('fetch', fetchMock)
    const play = vi.fn()

    const out = await runAgent([{ role: 'user', content: 'faster' }], { apiKey: 'k', model: 'm' }, {
      getProject: () => project,
      run: (name, args) => {
        const r = applyCommand(project, name, args)
        project = r.project
        return r.result
      },
      play,
      stop: vi.fn(),
    })

    expect(project.bpm).toBe(140)
    expect(play).toHaveBeenCalledOnce()
    const tools = out.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!))
    expect(tools[0].ok).toBe(true)
    expect(tools[1]).toMatchObject({ ok: false, error: expect.stringContaining('No channel') })
    expect(out.at(-1)).toEqual({ role: 'assistant', content: 'Done: 140 BPM.' })

    // Second request carries the tool results and the updated project state.
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.messages[0].content).toContain('"bpm":140')
    expect(body.messages.filter((m: { role: string }) => m.role === 'tool')).toHaveLength(3)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
  })

  it('surfaces HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })))
    await expect(
      runAgent([{ role: 'user', content: 'x' }], { apiKey: 'k', model: 'm' }, {
        getProject: demoProject,
        run: () => null,
        play: () => {},
        stop: () => {},
      }),
    ).rejects.toThrow(/401/)
  })
})
