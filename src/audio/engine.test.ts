import { describe, expect, it } from 'vitest'
import { applyCommand, demoProject } from '../core/commands'
import { songStepEvents, valueAt } from './engine'

describe('automation curve', () => {
  const pts = [{ t: 16, v: 0 }, { t: 32, v: 1 }, { t: 32, v: 0.2 }]
  it('holds before the first and after the last point, interpolates between', () => {
    expect(valueAt([], 5)).toBeNull()
    expect(valueAt(pts, 0)).toBe(0)
    expect(valueAt(pts, 24)).toBe(0.5)
    expect(valueAt(pts, 40)).toBe(0.2)
  })
})

describe('song playback', () => {
  it('maps song steps to the pattern steps of the clips under them', () => {
    let p = demoProject() // Chords on track 1 at bars 0,2,4; Beat on track 0 at bars 2,4
    expect(songStepEvents(p, 0).map((e) => [e.pattern.name, e.step])).toEqual([['Chords', 0]])
    expect(songStepEvents(p, 33).map((e) => [e.pattern.name, e.step]).sort()).toEqual([['Beat', 1], ['Chords', 1]])
    // A clip longer than its pattern loops the pattern.
    p = applyCommand(p, 'add_clip', { pattern: 'Beat', track: 2, bar: 8, bars: 4 }).project
    expect(songStepEvents(p, 8 * 16 + 33)).toMatchObject([{ step: 1 }])
    expect(songStepEvents(p, 200)).toEqual([])
  })
})
