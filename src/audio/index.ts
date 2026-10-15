import { useEffect, useState } from 'react'
import { useDaw } from '../core/store'
import { AudioEngine, type Position } from './engine'

export const engine = new AudioEngine(() => useDaw.getState().project)

useDaw.subscribe((s, prev) => {
  if (s.project !== prev.project) engine.sync(s.project)
})

/** Playback position, or null when stopped. */
export function usePosition(): Position | null {
  const [pos, setPos] = useState<Position | null>(null)
  useEffect(() => engine.onPosition(setPos), [])
  return pos
}
