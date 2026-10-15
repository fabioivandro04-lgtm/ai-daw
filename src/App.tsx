import { useEffect, useState } from 'react'
import { loadSamples } from './audio/samples'
import { AIPanel } from './components/AIPanel'
import { ChannelRack } from './components/ChannelRack'
import { Mixer } from './components/Mixer'
import { PianoRoll } from './components/PianoRoll'
import { Playlist } from './components/Playlist'
import { loadSettings, saveSettings, SettingsDialog } from './components/Settings'
import { currentPattern } from './core/commands'
import { useDaw } from './core/store'
import { sampleIds, togglePlay } from './ui/actions'
import { TopBar } from './ui/TopBar'
import { useUi, type WindowId } from './ui/ui'
import { Window } from './ui/Window'

const F_KEYS: Record<string, WindowId> = { F5: 'playlist', F6: 'channelRack', F7: 'pianoRoll', F9: 'mixer' }

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const aiOpen = useUi((s) => s.aiOpen)
  const selected = useDaw((s) => s.project.channels.find((c) => c.id === s.selectedChannelId))
  const patName = useDaw((s) => currentPattern(s.project).name)
  const samples = useDaw((s) => sampleIds(s.project).join(','))

  // Decode saved samples up front; an offline context needs no user gesture.
  useEffect(() => {
    if (samples) loadSamples(samples.split(','), new OfflineAudioContext(1, 1, 44100)).catch(() => {})
  }, [samples])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select')) return
      const ctrl = e.ctrlKey || e.metaKey
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useDaw.getState().redo()
        else useDaw.getState().undo()
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useDaw.getState().redo()
      } else if (!ctrl && e.key.toLowerCase() === 'l') {
        const { project, run } = useDaw.getState()
        run('set_song_mode', { on: !project.songMode })
      } else if (F_KEYS[e.key]) {
        e.preventDefault()
        useUi.getState().toggle(F_KEYS[e.key])
      } else if (e.key === 'F10') {
        e.preventDefault()
        useUi.getState().setAiOpen(!useUi.getState().aiOpen)
      } else if (e.key === 'F4') {
        e.preventDefault()
        useDaw.getState().run('add_pattern', {})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar onSettings={() => setShowSettings(true)} />
      <main className="workspace">
        <div className="desk">
          <Window id="playlist" title="Playlist — Arrangement">
            <Playlist />
          </Window>
          <Window id="channelRack" title={`Channel rack — ${patName}`}>
            <ChannelRack />
          </Window>
          <Window id="pianoRoll" title={`Piano roll — ${selected?.name ?? 'no channel'} — ${patName}`}>
            <PianoRoll />
          </Window>
          <Window id="mixer" title="Mixer">
            <Mixer />
          </Window>
        </div>
        {aiOpen && <AIPanel settings={settings} onNeedSettings={() => setShowSettings(true)} />}
      </main>
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            saveSettings(s)
            setSettings(s)
            setShowSettings(false)
          }}
        />
      )}
    </div>
  )
}
