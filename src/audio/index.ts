import { useEffect, useState } from 'react'
import { useDaw } from '../core/store'
import { AudioEngine } from './engine'

export const engine = new AudioEngine(() => useDaw.getState().project)

useDaw.subscribe((s, prev) => {
  if (s.project !== prev.project) engine.sync(s.project)
})

export function useCurrentStep(): number | null {
  const [step, setStep] = useState<number | null>(null)
  useEffect(() => engine.onStep(setStep), [])
  return step
}
