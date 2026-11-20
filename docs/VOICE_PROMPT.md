# Prompt for a new chat: voice for Genisys (talk to it, it talks back)

Copy everything below the line into a new Claude Code chat opened in `C:\DEV-PROJECTS\KEVIN\GENISYS\my-app`.

---

You are adding voice to **Genisys**, my Windows AI assistant (Electron 39 + Vite, Electron Forge, `node:sqlite`). Goal: I talk to it like Wispr Flow (hold a key, speak, let go) and it answers out loud. Build it in two stages and finish Stage 1 completely (working, tested in the real app) before starting Stage 2.

## What already exists (reuse it, do not rebuild it)
- **Main / renderer / preload IPC.** `src/main.js` is the main process, `src/preload.js` exposes `window.api`, and `src/app.js` is the chat page. `src/renderer.js` picks a module by window mode: main, runner (the Alt+Space command bar), agent, tool.
- **Where a typed request goes.** `src/app.js` → the form submit → `fastFlow(task)`:
  1. `parseIntent` (`src/fast/intent.js`, regex parsers in `src/fast/siri.js`, typo fixer in `src/fast/spell.js`).
  2. If it isn't understood, the cache, then the router model, then the AI agent loop.

  A voice transcript must enter at exactly this point, as if typed. Don't add a second pipeline.
- **AI calls happen only in the main process.** The renderer CSP is `default-src 'self'`, so the renderer can't call external APIs, and keys must never reach it.
  - Keys live in `%APPDATA%/Executor/config.json`.
  - Groq is already configured as a "fast provider" (`DEFAULT_PROVIDERS`, `providerKeys.groq`).
  - Users can also add their own OpenAI, Gemini or other keys (`OWN` in `main.js`).
  - Model calls use `stream: false` today.
- **Stop:** each window has its own AbortController (AsyncLocalStorage), and the Stop button / Esc cancels requests. Voice must use it (Esc stops listening, thinking and speaking).
- **UI pieces:**
  - The animated orb (`createLiveOrb` in `src/orb.js`): use it for listening, thinking and speaking states.
  - Tool cards (`src/toolcards.js`) and the floating tool window (`src/toolwin.js`).
  - The glass buttons in `index.html`.
- **Hotkeys (`globalShortcut` in `main.js`):** Ctrl+Alt+G opens the app, Alt+Space (or Alt+Shift+Space) opens the runner, Ctrl+Alt+N opens a new agent.
  - `globalShortcut` fires on key DOWN only; it has no key-up event.
- **A hidden PowerShell process that is always running** (`src/fast/helper.js`) answers system calls in about 0.1 s and already compiles C# (Core Audio). It can poll `GetAsyncKeyState` to detect when a held key is released, which gives hold-to-talk without a native npm module.
- **Database (`src/db.js`):** `convo` holds chats, `prefs` holds settings, `tool_log` holds tool history. Store voice settings in prefs and transcripts in `convo` (route `voice`). Don't store audio by default.
- **Audio playback:** the CSP allows `media-src 'self' blob: http://127.0.0.1:*`, so a blob `<audio>` works. An in-app music player and alarm ringing exist; pause or duck music while Genisys listens or speaks.
- **Conventions:**
  - Small, complete changes.
  - A test for every new piece of logic (`node --test`, run with `npm test`; ~292 tests pass now).
  - Never `String.replace` with `$` in the replacement string.
  - No Claude attribution in commits.
  - Read `docs/ADD_AN_ACTION.md` and `docs/TEST_SHEET.md` first.

## Stage 1: normal voice input and output (press, speak, release → it answers out loud)

| Layer | What to use | Install |
|---|---|---|
| 1. Trigger | Mic button in the input bar (main window and runner) + global hotkey. Default **toggle** mode with `globalShortcut` (press = start, press again or 1.2 s of silence = stop). **Hold-to-talk** = key down from `globalShortcut` + key release from the PowerShell helper polling `GetAsyncKeyState` every ~30 ms. Pick a free key (check it registers; Ctrl+Alt+Space is taken by other apps). | nothing |
| 2. Microphone | `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` + `MediaRecorder` (webm/opus) in the renderer. In main, allow only `media` and only for the app's own origin (`session.setPermissionRequestHandler` / `setPermissionCheckHandler`). If Windows blocks the mic ("Let desktop apps access your microphone"), tell the user clearly and open `ms-settings:privacy-microphone`. | nothing |
| 3. End of speech | Stage 1: simple energy VAD (RMS from an `AnalyserNode`). Stop after ~1.2 s below the noise floor; ignore clips under 0.4 s; max 60 s. | nothing |
| 4. Speech-to-text | Send the audio as an ArrayBuffer over IPC to **main**. Main posts it (`FormData` + `Blob`, built into Node 22) to **Groq `whisper-large-v3-turbo`** (OpenAI-compatible `/openai/v1/audio/transcriptions`, very fast and cheap; the Groq key already exists). Fallback: the user's own OpenAI key (current OpenAI transcription model; check the docs for the ID). Pass Whisper a `prompt` with words it must spell right: app names from the catalog, list names, contact names, "Genisys". No key or offline → say so and keep the typed input working. | nothing |
| 5. Clean-up (the Wispr Flow part) | Pure function `cleanTranscript(text)` with tests. It drops fillers (um, uh, "you know"), applies self-corrections ("at 5, no wait, at 6" → at 6; "Tuesday, actually make that Wednesday" → Wednesday), fixes Whisper's habits (trailing "Thank you.", hallucinated captions on silence), and normalises numbers and times ("six thirty pm" → 6:30 pm). Then the text goes into `fastFlow` like typed text, so `spell.js` also fixes sound-alike words for command words; add a small homophone map there (e.g. "timer"/"time a", "remind her" → "reminder"). | nothing |
| 6. Brain | Unchanged: `fastFlow` → fast path → AI. Show the transcript as the user's message (with a small mic icon). | nothing |
| 7. What to say back | Pure function `speakable(answer)` with tests. It strips markdown, code, paths and URLs, says "I made the file on your Desktop" instead of a path, and reads cards briefly ("Timer set for 5 minutes, it rings at 13:20"). Ask the AI for one short spoken sentence when the reply came by voice. | nothing |
| 8. Text-to-speech | Stage 1 default: **`speechSynthesis`** in the renderer, using Windows' own voices (offline, free, instant). Pick a natural voice and let the user change it in Settings. Optional better voice: a cloud TTS through main (the user's OpenAI key, or Groq if its TTS model is live; check the docs), played as a blob `<audio>`. | nothing |
| 9. UI states | Orb: listening (reacts to mic level), thinking, speaking. Esc or Stop cancels everything. Starting to talk stops the voice (barge-in, simple version). Duck the in-app music player while listening or speaking. In the runner: speak, then the answer shows as a floating tool card and is spoken. | nothing |
| 10. Settings | Voice on/off, hotkey and mode (toggle / hold), language (auto / English / Kinyarwanda / French), voice and speed, "speak replies" (always / only when I spoke / never), mic device. All in `prefs`. | nothing |

**Stage 1 is done when:**
1. In the real app, hotkey → "set a timer for 5 minutes called tea" → the timer card appears and it says "Timer set for 5 minutes" out loud.
2. "What's the weather in Kigali tomorrow" works the same way.
3. "Make a folder on my desktop called voice test" goes through the AI path and its answer is spoken.
4. Esc stops it mid-sentence.
5. A clear message appears when the mic is blocked, with no key, and offline.
6. Unit tests cover `cleanTranscript` and `speakable`.

**Automated testing without talking:**
- Start Electron with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<file.wav>`. The mic then plays a WAV file you made (record a few phrases once, or generate them with Windows TTS into `test/audio/`).
- Drive the app over CDP (port 9333), as the existing test scripts do.

## Stage 2: voice streaming (talk naturally; it answers while it thinks)

| Layer | What to use | Install |
|---|---|---|
| 1. Mic stream | `AudioWorklet` → 16 kHz PCM16 frames (20–40 ms) → IPC to main, continuously while the session is open. The worklet file is `'self'`, which the CSP already allows. | nothing |
| 2. Real voice-activity detection | Silero VAD: `@ricky0123/vad-web` in the renderer, or inside main with `sherpa-onnx-node`. WebAssembly in the renderer needs `'wasm-unsafe-eval'` added to the CSP `script-src` (only that). | `@ricky0123/vad-web` (+ `onnxruntime-web`) **or** use sherpa's VAD |
| 3. Streaming speech-to-text | Cloud: OpenAI Realtime **transcription** session over WebSocket (`wss://api.openai.com/v1/realtime?intent=transcription`, streaming transcription model; check the current ID and headers in the official docs, since they changed during 2026). It needs the user's OpenAI key. Main uses Node 22's built-in `WebSocket`. Offline/free alternative: **sherpa-onnx** streaming Zipformer models in main (`sherpa-onnx-node`), with partial results every ~100 ms. | none for cloud; `sherpa-onnx-node` + model files for offline |
| 4. Early intent | Run `parseIntent` on partial transcripts. When a fast-path command is clearly complete ("set a timer for 5 minutes" + end of speech), act right away. Send nothing to the AI until speech ends. | nothing |
| 5. Streaming the AI's answer | Add `stream: true` (SSE) to the OpenRouter and Groq calls in `main.js`, keeping the non-streaming path for everything else. Stream tokens to the window, cut them into sentences, and start speaking sentence 1 while sentence 2 is still being written. | nothing |
| 6. Streaming text-to-speech | One sentence at a time into a play queue. Offline natural voice: **Kokoro** through `sherpa-onnx-node`. Cloud: a streaming TTS endpoint (user's key). Fallback: `speechSynthesis` per sentence. | `sherpa-onnx-node` + Kokoro model (~100–300 MB, download on first use with a progress bar and a checksum, never bundled) |
| 7. Barge-in and echo | VAD keeps running while Genisys speaks. When the user talks: stop the audio, abort the request (the existing AbortController), and start listening. Keep `echoCancellation` on, and play speech through the same page so Chromium's echo canceller can hear it. | nothing |
| 8. Optional: full speech-to-speech | OpenAI Realtime speech-to-speech model (current one, e.g. `gpt-realtime-2`; check it), with Genisys actions exposed as function tools from the action registry (`actions/*/action.json`, validated by `registry.validateParams`). Natural, but costly and cloud-only: make it an opt-in mode, not the default. | nothing |
| 9. Native modules (only if sherpa-onnx is used) | Add `@electron-forge/plugin-auto-unpack-natives` so `.node` files work inside the asar. Check `npm run make` and the Inno Setup installer still work, and check the app size. | `@electron-forge/plugin-auto-unpack-natives` |

**Stage 2 targets:**
- Under ~1.2 s from end of speech to the first spoken word on a fast-path command.
- Under ~2.5 s on an AI answer.
- Barge-in stops speech within 300 ms.
- Measure and show these timings in the debug log.

## Rules
- Before writing code, read the files listed above and write a short plan (files to touch, new modules, tests). Ask me only if a choice changes cost or privacy (for example, cloud vs offline default).
- Keys stay in main. Audio is sent only to the STT provider the user configured. No audio is saved unless a "keep recordings" setting is on (off by default). Never send names, email or paths into URLs.
- After each stage, test it as a normal user in the real app (`npm start`, CDP on port 9333).
- Also read my real chat history from `%APPDATA%/Executor/executor.db` (tables `convo`, `tool_log`), say the commands I actually use, and fix what goes wrong.
- Then report which tests pass, which layers you could not verify (for example, a real mic vs the fake WAV), and anything left.
