# AI DAW

A browser DAW (FL Studio–style) built around AI: type or talk to make music, hum a melody into the piano roll, beatbox a drum pattern.

## Run

```bash
npm install
npm run dev     # open http://localhost:5173 in Chrome or Edge
npm test        # unit tests
```

Open **Settings** and paste an [OpenRouter API key](https://openrouter.ai/keys). The key is stored only in your browser and sent only to openrouter.ai.

## What works

- **Channel rack**: 16th-note step sequencer, 1–8 bars, mute, sound per channel.
- **Piano roll**: click to add, drag to move, drag the right edge to resize, right-click to delete. Notes in the key are highlighted.
- **Mixer**: volume, pan, mute, solo, master.
- **Transport**: play/stop (Space), BPM, swing, key and scale, undo/redo (Ctrl+Z / Ctrl+Shift+Z), WAV export.
- **AI producer**: chat or 🎤 talk ("make a trap beat at 140", "add a dark pad Am F C G"). The model edits the project through tools; one Ctrl+Z undoes a whole AI reply.
- **Hum → notes**: YIN pitch detection, split into notes, quantized to the grid, snapped to the key and moved to the channel's octave.
- **Beatbox → drums**: onset detection, classified into kick / snare / hat by spectrum, written to the step sequencer.
- Synthesized instruments (no samples): kick, snare, clap, hat, open hat, tom, rim, crash; bass, sub, lead, pad, pluck, keys.
- The project autosaves to the browser.

## Architecture

```
src/core/      project model + command API (every change is a command → undo, AI and UI share it)
src/audio/     Web Audio engine (lookahead scheduler), synth/drum voices, WAV export, mic recorder
src/ai/        OpenRouter agent loop, pitch tracking, beatbox detection, speech input
src/components UI: toolbar, channel rack, piano roll, mixer, AI panel
```

To give the AI a new ability, add a command to `src/core/commands.ts`; it becomes a UI action and an AI tool at the same time.

## Known limits

- The API key lives in the browser: fine for personal use. For a public site, proxy requests through a small backend.
- Speech input uses the browser's speech recognition (Chrome, Edge, Safari).
- Without "Play loop while recording", the first hummed note or hit is placed on beat 1. With the loop on, timing is relative to the start of the recording and may be a few milliseconds off.
- One pattern only, so far: no playlist/arrangement, audio clips, effects or VST plugins yet.
