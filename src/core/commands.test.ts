import { describe, expect, it } from 'vitest'
import { applyCommand, currentPattern, demoProject, emptyProject, findChannel, migrateProject, notesOf, songBars } from './commands'
import { midiToName, parsePitch, snapToScale } from './music'
import type { Project } from './types'

const run = (p: Project, name: string, args: unknown) => applyCommand(p, name, args).project
const notes = (p: Project, ch: string, pat?: string) => {
  const pattern = pat ? p.patterns.find((x) => x.name === pat)! : currentPattern(p)
  return notesOf(pattern, findChannel(p, ch).id)
}

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
    expect(snapToScale(61, 9, 'minor')).toBe(60)
    expect(snapToScale(66, 9, 'minor')).toBe(65)
  })
})

describe('channels', () => {
  it('adds channels with unique names, each on its own mixer insert', () => {
    let p = emptyProject()
    p = run(p, 'add_channel', { name: 'Drums', type: 'drum', sound: 'kick' })
    p = run(p, 'add_channel', { name: 'drums', type: 'drum', sound: 'snare' })
    expect(p.channels.map((c) => [c.name, c.insert])).toEqual([['Drums', 1], ['drums 2', 2]])
    expect(p.mixer[1].name).toBe('Drums')
    p = run(p, 'set_drum_steps', { channel: 'DRUMS', steps: [0, 8] })
    expect(notes(p, 'Drums').map((n) => n.start)).toEqual([0, 8])
  })

  it('rejects bad input with helpful errors', () => {
    const p = demoProject()
    expect(() => run(p, 'add_channel', { name: 'x', type: 'drum', sound: 'pad' })).toThrow(/not a drum sound/)
    expect(() => run(p, 'add_notes', { channel: 'Piano', notes: [] })).toThrow(/Existing channels/)
    expect(() => run(p, 'add_notes', { channel: 'Bass', notes: [{ pitch: 'C2', start: 999, length: 1 }] })).toThrow(/outside pattern/)
    expect(() => run(p, 'set_channel', { channel: 'Bass', insert: 99 })).toThrow(/does not exist/)
  })

  it('removing a channel removes its notes from every pattern', () => {
    let p = demoProject()
    const id = findChannel(p, 'Pad').id
    p = run(p, 'remove_channel', { channel: 'Pad' })
    expect(p.patterns.every((pat) => !(id in pat.notes))).toBe(true)
  })
})

describe('notes in patterns', () => {
  it('adds, replaces, transposes and removes notes in the current pattern', () => {
    let p = demoProject()
    p = run(p, 'add_notes', { channel: 'Bass', replace: true, notes: [{ pitch: 'C2', start: 4, length: 2 }, { pitch: 'E2', start: 0, length: 2 }] })
    expect(notes(p, 'Bass').map((n) => [n.pitch, n.start])).toEqual([[40, 0], [36, 4]])
    p = run(p, 'transpose', { channel: 'Bass', semitones: 12 })
    expect(notes(p, 'Bass').map((n) => n.pitch)).toEqual([52, 48])
    p = run(p, 'remove_notes', { channel: 'Bass', from_step: 2, to_step: 8 })
    expect(notes(p, 'Bass')).toHaveLength(1)
  })

  it('writes to a named pattern without touching the others', () => {
    let p = demoProject()
    p = run(p, 'add_notes', { channel: 'Bass', pattern: 'Chords', notes: [{ pitch: 'A1', start: 0, length: 4 }] })
    expect(notes(p, 'Bass', 'Chords')).toHaveLength(1)
    expect(notes(p, 'Bass', 'Beat')).toHaveLength(8)
  })

  it('ignores repeated drum steps and toggles single steps', () => {
    let p = run(demoProject(), 'set_drum_steps', { channel: 'Kick', steps: [0, 0, 4] })
    expect(notes(p, 'Kick').map((n) => n.start)).toEqual([0, 4])
    p = run(p, 'toggle_step', { channel: 'Kick', step: 2 })
    expect(notes(p, 'Kick').map((n) => n.start)).toEqual([0, 2, 4])
    p = run(p, 'toggle_step', { channel: 'Kick', step: 2 })
    expect(notes(p, 'Kick').map((n) => n.start)).toEqual([0, 4])
  })

  it('trims notes when a pattern gets shorter', () => {
    const p = run(demoProject(), 'set_pattern_length', { bars: 1 })
    expect(currentPattern(p).lengthSteps).toBe(16)
    expect(notes(p, 'Kick').every((n) => n.start < 16)).toBe(true)
  })
})

describe('patterns and playlist', () => {
  it('clones a pattern with independent notes', () => {
    let p = run(demoProject(), 'clone_pattern', { pattern: 'Beat', name: 'Beat B' })
    expect(currentPattern(p).name).toBe('Beat B')
    p = run(p, 'remove_notes', { channel: 'Kick' })
    expect(notes(p, 'Kick', 'Beat B')).toHaveLength(0)
    expect(notes(p, 'Kick', 'Beat')).toHaveLength(8)
  })

  it('deleting a pattern removes its clips and keeps a valid current pattern', () => {
    let p = demoProject()
    p = run(p, 'delete_pattern', { pattern: 'Beat' })
    expect(p.playlist.every((c) => p.patterns.some((pat) => pat.id === c.patternId))).toBe(true)
    expect(currentPattern(p).name).toBe('Chords')
    expect(() => run(p, 'delete_pattern', { pattern: 'Chords' })).toThrow(/at least one/)
  })

  it('places, moves and removes clips; song length follows the last clip', () => {
    let p = demoProject()
    expect(songBars(p)).toBe(6)
    p = run(p, 'add_clip', { pattern: 'Beat', track: 2, bar: 8 })
    expect(songBars(p)).toBe(10)
    const id = p.playlist.at(-1)!.id
    p = run(p, 'move_clip', { id, bar: 12 })
    expect(songBars(p)).toBe(14)
    p = run(p, 'remove_clip', { id })
    expect(songBars(p)).toBe(6)
  })
})

describe('mixer and automation', () => {
  it('adds, edits and removes effects; validates params', () => {
    let p = run(demoProject(), 'add_fx', { insert: 'Bass', type: 'distortion', params: { drive: 0.8 } })
    const n = findChannel(p, 'Bass').insert
    expect(p.mixer[n].fx[0]).toMatchObject({ type: 'distortion', on: true, params: { drive: 0.8 } })
    p = run(p, 'set_fx', { insert: n, slot: 0, on: false, mix: 0.5 })
    expect(p.mixer[n].fx[0]).toMatchObject({ on: false, mix: 0.5 })
    expect(() => run(p, 'set_fx', { insert: n, slot: 0, params: { nope: 1 } })).toThrow(/no parameter/)
    p = run(p, 'remove_fx', { insert: n, slot: 0 })
    expect(p.mixer[n].fx).toHaveLength(0)
  })

  it('removing an FX slot drops its automation and re-points later slots', () => {
    let p = demoProject()
    const pad = findChannel(p, 'Pad').insert
    p = run(p, 'add_fx', { insert: pad, type: 'delay' })
    p = run(p, 'set_automation', { target: `insert:${pad}:fx:1:mix`, points: [{ bar: 0, value: 0 }] })
    p = run(p, 'remove_fx', { insert: pad, slot: 0 })
    expect(p.automation.map((l) => l.target)).toEqual([`insert:${pad}:fx:0:mix`])
  })

  it('resolves automation targets by name and rejects bad ones', () => {
    let p = run(demoProject(), 'set_automation', { target: 'channel:Bass:volume', points: [{ bar: 1, value: 0 }, { bar: 0, value: 1 }] })
    const lane = p.automation.at(-1)!
    expect(lane.target).toBe(`channel:${findChannel(p, 'Bass').id}:volume`)
    expect(lane.points).toEqual([{ t: 0, v: 1 }, { t: 16, v: 0 }])
    expect(() => run(p, 'set_automation', { target: 'insert:1:fx:5:mix', points: [{ bar: 0, value: 0 }] })).toThrow(/no FX/)
    p = run(p, 'set_automation', { target: 'channel:Bass:volume', points: [{ bar: 0, value: 0.5 }] })
    expect(p.automation.filter((l) => l.target === lane.target)).toHaveLength(1)
  })
})

describe('migration', () => {
  it('upgrades a version-1 project into one pattern with mixer routing', () => {
    const v1 = {
      bpm: 100, swing: 0.2, lengthSteps: 16, keyRoot: 2, scale: 'major', masterVolume: 0.7,
      channels: [{ id: 'c1', name: 'Kick', type: 'drum', sound: 'kick', notes: [{ id: 'n1', pitch: 60, start: 0, length: 1, velocity: 1 }], volume: 0.5, pan: 0, mute: false, solo: true, color: '#fff' }],
    }
    const p = migrateProject(v1)
    expect(p.version).toBe(2)
    expect(p.patterns).toHaveLength(1)
    expect(p.patterns[0].notes.c1).toHaveLength(1)
    expect(p.channels[0].insert).toBe(1)
    expect(p.mixer[1]).toMatchObject({ name: 'Kick', solo: true })
    expect(p.mixer[0].volume).toBe(0.7)
    expect(migrateProject(p)).toBe(p)
  })
})
