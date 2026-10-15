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

- **FL-style workspace**: top bar with FILE / EDIT / ADD / PATTERNS / VIEW menus, PAT/SONG switch, tempo, bar:beat:step clock, swing, key, pattern selector with pattern options, and floating windows (Playlist F5, Channel rack F6, Piano roll F7, Mixer F9, AI F10).
- **Channel rack**: per channel mute LED, pan and volume knobs, mixer insert routing, sound, step sequencer (drums/samples) or mini piano-roll preview (synths). Drop WAV/MP3 files on it to add sample channels.
- **Patterns + playlist**: any number of patterns (new, clone, rename, delete, length 1-8 bars); paint them onto playlist tracks, drag, resize (loops the pattern), right-click to delete, click the ruler to play from a bar.
- **Mixer**: Master + 16 inserts with peak meters, faders (dB), pan, mute, solo; 8 FX slots per insert — reverb, delay (tempo-synced), filter (LP/HP/BP), distortion, 3-band EQ, compressor, chorus — each with on/off, mix and parameter knobs.
- **Automation**: lanes under the playlist for insert volume/pan, any FX parameter or mix, and channel volume/pan; click to add points, drag, right-click to delete. Plays in SONG mode.
- **Piano roll**: click to add, drag to move, drag the right edge to resize, right-click to delete; scale rows highlighted.
- **AI producer**: chat or 🎤 talk. It can create patterns per section, arrange them in the playlist, add effects and automation ("make a 4-bar intro then a drop with a filter sweep"). One Ctrl+Z undoes a whole AI reply.
- **Hum → notes** and **beatbox → drums** into the current pattern.
- WAV export of the song (SONG mode) or pattern (PAT mode). Projects autosave in the browser; older saves are migrated.

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
- Not yet: audio clips recorded straight into the playlist, sends between inserts, VST/CLAP plugins.
