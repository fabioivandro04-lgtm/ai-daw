import { useEffect, useState } from 'react'
import { engine } from './audio'
import { AIPanel } from './components/AIPanel'
import { ChannelRack } from './components/ChannelRack'
import { Mixer } from './components/Mixer'
import { PianoRoll } from './components/PianoRoll'
import { loadSettings, saveSettings, SettingsDialog } from './components/Settings'
import { Toolbar } from './components/Toolbar'
import { useDaw } from './core/store'

export default function App() {
  const [playing, setPlaying] = useState(false)
  const [tab, setTab] = useState<'piano' | 'mixer'>('piano')
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const selected = useDaw((s) => s.project.channels.find((c) => c.id === s.selectedChannelId))

  // Track transport state from the engine so AI-triggered play/stop updates the button.
  useEffect(() => engine.onStep((step) => setPlaying(step !== null || engine.playing)), [])

  const togglePlay = () => {
    if (engine.playing) engine.stop()
    else engine.play().then(() => setPlaying(true))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select')) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useDaw.getState().redo()
        else useDaw.getState().undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useDaw.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <Toolbar playing={playing} onTogglePlay={togglePlay} onSettings={() => setShowSettings(true)} />
      <main className="workspace">
        <div className="left">
          <ChannelRack />
          <section className="panel editor">
            <div className="tabs">
              <button className={tab === 'piano' ? 'active' : ''} onClick={() => setTab('piano')}>
                Piano roll{selected ? ` — ${selected.name}` : ''}
              </button>
              <button className={tab === 'mixer' ? 'active' : ''} onClick={() => setTab('mixer')}>
                Mixer
              </button>
            </div>
            {tab === 'piano' ? <PianoRoll /> : <Mixer />}
          </section>
        </div>
        <AIPanel settings={settings} onNeedSettings={() => setShowSettings(true)} />
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
