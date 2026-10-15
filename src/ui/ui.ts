import { useEffect } from 'react'
import { create } from 'zustand'

export type WindowId = 'playlist' | 'channelRack' | 'pianoRoll' | 'mixer'

export interface WinState {
  open: boolean
  x: number
  y: number
  w: number
  h: number
  z: number
  max: boolean
}

const DEFAULTS: Record<WindowId, WinState> = {
  playlist: { open: true, x: 0, y: 0, w: 1100, h: 560, z: 1, max: true },
  channelRack: { open: true, x: 180, y: 300, w: 780, h: 270, z: 3, max: false },
  pianoRoll: { open: false, x: 120, y: 90, w: 900, h: 460, z: 2, max: false },
  mixer: { open: false, x: 60, y: 60, w: 1040, h: 470, z: 2, max: false },
}

const KEY = 'ai-daw:windows'

function load(): Record<WindowId, WinState> {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return DEFAULTS
  }
}

interface UiState {
  windows: Record<WindowId, WinState>
  selectedInsert: number
  aiOpen: boolean
  toggle: (id: WindowId, open?: boolean) => void
  focus: (id: WindowId) => void
  move: (id: WindowId, patch: Partial<WinState>) => void
  selectInsert: (n: number) => void
  setAiOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set, get) => ({
  windows: load(),
  selectedInsert: 0,
  aiOpen: true,
  toggle: (id, open) => {
    const w = get().windows[id]
    const next = open ?? !w.open
    set({ windows: { ...get().windows, [id]: { ...w, open: next } } })
    if (next) get().focus(id)
  },
  focus: (id) => {
    const top = Math.max(...Object.values(get().windows).map((w) => w.z))
    if (get().windows[id].z === top) return
    set({ windows: { ...get().windows, [id]: { ...get().windows[id], z: top + 1 } } })
  },
  move: (id, patch) => set({ windows: { ...get().windows, [id]: { ...get().windows[id], ...patch } } }),
  selectInsert: (n) => set({ selectedInsert: n }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
}))

useUi.subscribe((s, prev) => {
  if (s.windows === prev.windows) return
  try {
    localStorage.setItem(KEY, JSON.stringify(s.windows))
  } catch {
    // Window layout is a convenience; ignore storage errors.
  }
})

export function useAnimation(fn: () => void) {
  useEffect(() => {
    let id = 0
    const loop = () => {
      fn()
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
