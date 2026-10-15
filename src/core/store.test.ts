import { describe, expect, it } from 'vitest'
import { useDaw } from './store'

describe('undo', () => {
  it('undoes a whole group (one AI reply) in one step', () => {
    const { run, undo } = useDaw.getState()
    const start = useDaw.getState().project
    run('set_tempo', { bpm: 90 })
    const afterSingle = useDaw.getState().project
    run('set_tempo', { bpm: 100 }, { group: 'ai-1' })
    run('add_channel', { name: 'Pad', type: 'synth', sound: 'pad' }, { group: 'ai-1' })
    undo()
    expect(useDaw.getState().project).toBe(afterSingle)
    undo()
    expect(useDaw.getState().project).toBe(start)
    useDaw.getState().redo()
    expect(useDaw.getState().project).toBe(afterSingle)
  })
})
