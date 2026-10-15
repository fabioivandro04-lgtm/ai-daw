import { describe, expect, it } from 'vitest'
import { applyCommand, demoProject, emptyProject } from './commands'
import { midiToName, parsePitch, snapToScale } from './music'

describe('music helpers', () => {
  it('parses pitch names and MIDI numbers', () => {
    expect(parsePitch('C4')).toBe(60)
    expect(parsePitch('A1')).toBe(33)
    expect(parsePitch('Bb3')).toBe(58)
    expect(parsePitch('f#2')).toBe(42)
    expect(parsePitch(64)).toBe(64)
    expect(parsePitch('64')).toBe(64)
    expect(midiToName(61)).toBe('C#4')
    expect(() => parsePitch('H2')).toThrow()
  })

  it('snaps to the scale', () => {
    expect(snapToScale(61, 9, 'minor')).toBe(60) // C# → C in A minor
    expect(snapToScale(66, 9, 'minor')).toBe(65) // F# → F
  })
})

describe('commands', () => {
  it('adds channels with unique names and finds them by name', () => {
    let p = emptyProject()
    p = applyCommand(p, 'add_channel', { name: 'Drums', type: 'drum', sound: 'kick' }).project
    p = applyCommand(p, 'add_channel', { name: 'drums', type: 'drum', sound: 'snare' }).project
    expect(p.channels.map((c) => c.name)).toEqual(['Drums', 'drums 2'])
    p = applyCommand(p, 'set_drum_steps', { channel: 'DRUMS', steps: [0, 8] }).project
    expect(p.channels[0].notes.map((n) => n.start)).toEqual([0, 8])
  })

  it('rejects mismatched sounds and unknown channels with helpful errors', () => {
    const p = demoProject()
    expect(() => applyCommand(p, 'add_channel', { name: 'x', type: 'drum', sound: 'pad' })).toThrow(/not a drum sound/)
    expect(() => applyCommand(p, 'add_notes', { channel: 'Piano', notes: [] })).toThrow(/Existing channels/)
    expect(() =>
      applyCommand(p, 'add_notes', { channel: 'Bass', notes: [{ pitch: 'C2', start: 999, length: 1 }] }),
    ).toThrow(/outside the pattern/)
  })

  it('adds, replaces, transposes and removes notes', () => {
    let p = demoProject()
    p = applyCommand(p, 'add_notes', {
      channel: 'Bass',
      replace: true,
      notes: [
        { pitch: 'C2', start: 4, length: 2 },
        { pitch: 'E2', start: 0, length: 2 },
      ],
    }).project
    const bass = () => p.channels.find((c) => c.name === 'Bass')!
    expect(bass().notes.map((n) => [n.pitch, n.start])).toEqual([
      [40, 0],
      [36, 4],
    ])
    p = applyCommand(p, 'transpose', { channel: 'Bass', semitones: 12 }).project
    expect(bass().notes.map((n) => n.pitch)).toEqual([52, 48])
    p = applyCommand(p, 'remove_notes', { channel: 'Bass', from_step: 2, to_step: 8 }).project
    expect(bass().notes).toHaveLength(1)
  })

  it('trims notes when the pattern gets shorter', () => {
    let p = demoProject()
    p = applyCommand(p, 'set_pattern_length', { bars: 1 }).project
    expect(p.lengthSteps).toBe(16)
    expect(p.channels.every((c) => c.notes.every((n) => n.start < 16))).toBe(true)
  })

  it('toggles single steps', () => {
    let p = demoProject()
    p = applyCommand(p, 'toggle_step', { channel: 'Kick', step: 2 }).project
    expect(p.channels[0].notes.some((n) => n.start === 2)).toBe(true)
    p = applyCommand(p, 'toggle_step', { channel: 'Kick', step: 2 }).project
    expect(p.channels[0].notes.some((n) => n.start === 2)).toBe(false)
  })
})
