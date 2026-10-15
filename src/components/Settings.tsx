import { useState } from 'react'
import type { AgentSettings } from '../ai/agent'

const KEY = 'ai-daw:settings'
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

export function loadSettings(): AgentSettings {
  try {
    return { apiKey: '', model: DEFAULT_MODEL, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { apiKey: '', model: DEFAULT_MODEL }
  }
}

export function saveSettings(s: AgentSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private mode: settings last for this tab only.
  }
}

export function SettingsDialog({ settings, onSave, onClose }: { settings: AgentSettings; onSave: (s: AgentSettings) => void; onClose: () => void }) {
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ apiKey: apiKey.trim(), model: model.trim() || DEFAULT_MODEL })
        }}
      >
        <h2>Settings</h2>
        <label>
          OpenRouter API key
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-or-…" autoComplete="off" />
        </label>
        <p className="hint">
          Stored only in this browser (localStorage) and sent only to openrouter.ai. Get one at{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            openrouter.ai/keys
          </a>
          .
        </p>
        <label>
          Model
          <input list="models" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="models">
            <option value="anthropic/claude-sonnet-4.5" />
            <option value="anthropic/claude-opus-4.1" />
            <option value="anthropic/claude-haiku-4.5" />
            <option value="openai/gpt-5" />
            <option value="google/gemini-2.5-pro" />
          </datalist>
        </label>
        <p className="hint">Any OpenRouter model that supports tool calling works. Copy the exact ID from openrouter.ai/models.</p>
        <div className="modal-buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
