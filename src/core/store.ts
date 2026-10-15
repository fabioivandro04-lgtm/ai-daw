import { create } from 'zustand'
import { applyCommand, demoProject, migrateProject } from './commands'
import type { Project } from './types'

const STORAGE_KEY = 'ai-daw:project'
const HISTORY_LIMIT = 200

interface HistoryEntry {
  project: Project
  group?: string
}

interface DawState {
  project: Project
  past: HistoryEntry[]
  future: Project[]
  selectedChannelId: string | null
  /** Runs a command and records it for undo. Commands sharing a `group` undo as one step. */
  run: (name: string, args: unknown, opts?: { group?: string }) => unknown
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
}

function loadSaved(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrateProject(JSON.parse(raw))
  } catch {
    // Storage unavailable or corrupt; fall back to the demo.
  }
  return demoProject()
}

const initial = loadSaved()

export const useDaw = create<DawState>((set, get) => ({
  project: initial,
  past: [],
  future: [],
  selectedChannelId: initial.channels.find((c) => c.type === 'synth')?.id ?? initial.channels[0]?.id ?? null,

  run: (name, args, opts) => {
    const { project, past } = get()
    const { project: next, result } = applyCommand(project, name, args)
    const last = past[past.length - 1]
    const sameGroup = opts?.group !== undefined && last?.group === opts.group
    set({
      project: next,
      past: sameGroup ? past : [...past, { project, group: opts?.group }].slice(-HISTORY_LIMIT),
      future: [],
    })
    if (name === 'add_channel' || name === 'add_sample_channel') set({ selectedChannelId: (result as { id: string }).id })
    return result
  },

  undo: () => {
    const { past, project, future } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({ project: prev.project, past: past.slice(0, -1), future: [project, ...future] })
  },

  redo: () => {
    const { past, project, future } = get()
    const [next, ...rest] = future
    if (!next) return
    set({ project: next, past: [...past, { project }], future: rest })
  },

  select: (id) => set({ selectedChannelId: id }),
}))

let saveTimer: ReturnType<typeof setTimeout> | undefined
useDaw.subscribe((s, prev) => {
  if (s.project === prev.project) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s.project))
    } catch {
      // Ignore quota/private-mode errors; autosave is a convenience.
    }
  }, 300)
})
