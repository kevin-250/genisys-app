# Genisys: project changelog and speed plan

> **How to use this file (read this first, AI assistant).**
> This file is the memory of the project. The user will upload the zipped project plus this file to a fresh chat that knows nothing about it.
> 1. Read this whole file. Then read only the source files the current stage needs.
> 2. Do **ONE stage only**: the first stage below whose status is `[ ]` (not done). Do not start the next stage.
> 3. Change only the files that need changing. Do not delete old code until the new system is proven (see "Standing rules").
> 4. When the stage is finished: tick its box `[x]`, fill in its **Result** block (what changed, files touched, what could NOT be tested), add a line to the **Change log** at the bottom, and return the whole project as a zip (without `node_modules`, `out`, `.vite`, `installer/dist`).
> 5. Tell the user, in a few lines: what you did, what you could not test, and what stage comes next.

---

## 1. What the app is

**Genisys** (formerly "Executor"): a Windows desktop AI assistant. The user types a command ("open the movie Mousetrap", "search elon musk net worth in chrome") and the app does it on their PC.

- Electron 39 + Electron Forge + Vite, plain JavaScript (no React). Windows only.
- Run it: `npm install`, then `npm start`. Package: `npm run package`. Installer: `npm run installer` (Inno Setup, see `installer/`).
- Frameless windows with their own title bar; native rounded corners from Windows 11 (`roundedCorners`); per-window light/dark theme (`sessionStorage`, main window uses `localStorage`).
- Many windows: main window, agent windows (`/agent N`, `/browser N`, `/script`), Alt+Space "runner" bar, floating plan widget.
- User data lives in `%APPDATA%\Executor` (config.json with API keys, executor.db SQLite). **Never move this folder.**

### How a command works NOW (Settings > Speed > Fast mode ON; OFF = the old flow below, unchanged)

```
user text
  0. "!" prefix, /agent, script/browser windows -> old flow
  1. saved .bat for an exact repeat (existing memory)            (0 AI calls)
  2. command cache (cmd_cache), target re-checked                 (<50 ms)
  3. code parser (src/fast/intent.js) -> native action            (<1 s, 0 AI calls)
       one clear match -> run;  2-3 close matches -> buttons;  unsure -> next
  4. AI router (1 short JSON call, Groq/Cerebras 5 s, then OpenRouter) -> validated action -> run
  5. AI script fallback (router said "script"): safety check -> user confirms -> run
  6. router said "old"/"unknown", or anything failed -> the old loop below
```

### How a command works in the OLD flow (speedMode "old", and step 6 above)


```
user text
  -> src/app.js builds a big SYSTEM prompt (rules, PC CONTEXT, memory, recipes)
  -> free OpenRouter model (key + model rotation in src/main.js)
  -> model replies with JSON: {say, cmd/find/app/web/delegate/..., done}
  -> the app runs the cmd (cmd/PowerShell via a generated .bat) or a native helper
  -> result goes back to the model, loop repeats until done (stuck detection, recipe hints, give-up messages)
```
Simple commands take 20-60 seconds because every step is a slow free-model round trip with a long prompt, and each command spawns a .bat/PowerShell (0.3-1 s startup each).

### Files (what lives where)

| File | What it does |
|---|---|
| `src/main.js` | Electron main process: windows, IPC, OpenRouter calls with key/model rotation, `find` (fuzzy file finder), `launchApp`, trash/restore, hotkeys, team/agent windows (`openAgent`, `openMany`, `agentDone`), debug log to `%TEMP%\genisys-debug.log` |
| `src/preload.js` | `contextBridge` exposing `window.api` to the page |
| `src/app.js` | Renderer logic: SYSTEM prompt, the `loop()`, live card, plan tree, slash menu (`/agent`, `/browser`, `/script`), team card, theme, text-generate effect |
| `index.html` | All CSS + markup |
| `src/db.js` | SQLite (`node:sqlite`): memory, profile, log, notes, settings |
| `src/memory.js` | Saved solutions: `keyOf`, `score`, `fixCmd` (reuse a command that worked before) |
| `src/cookbook.js` | 138 known-good recipes shown to the AI after failures |
| `src/fuzzy.js` | Typo-tolerant matching used by the file finder |
| `src/tabs.js` | Settings / memory pages |
| `src/anim.js`, `dots.js`, `orb.js`, `cobeglobe.js`, `todo.js`, `editor.js`, `accent.js` | UI pieces |
| `default-keys.json` | Now empty (`{"apiKeys": []}`); keys live in `%APPDATA%\Executor\config.json` |
| `src/fast/*.js` | Fast flow: `normalize`, `intent`, `actions`, `registry`, `cache`, `router`, `index` (path index), `safety`, `scriptFallback`, `stats` (+ `*.test.mjs`) |
| `actions/<name>/` | One folder per action: `action.json`, `prompt.md`, optional `template.ps1` (see `docs/ADD_AN_ACTION.md`) |
| `tools/` | `timing-report.mjs` (per stage), `stats.mjs` (per route / old vs new), `run-tests.mjs` (`npm test`) |
| `installer/` | Inno Setup installer |

### Existing assets we can reuse (do not rebuild)

- Native fuzzy file finder (`find` IPC in `main.js`) and `launchApp`.
- Saved-solution memory (`reuseSaved` in `app.js`, `memory.js`): already a primitive "cache".
- Key and model rotation for OpenRouter.
- `agentDone`, `openMany`, team card for multi-agent work.

---

## 2. Goal and targets

Make simple commands **feel instant** and cut tokens, **without losing correctness**.

| Case | Target |
|---|---|
| Simple command the code can decide (open app/file/folder/URL, web search) | **under 1 second**, zero model calls |
| Command that needs the AI (one short call) | **under 5 seconds** (hard limit 8) |
| Rare fallback (AI writes a script) | allowed to be slower, always safety-checked |
| Model calls per command | **max 2** for single-step commands |

Not a goal: copying big-company agents (screenshots, long loops). Keep it small, fast, cheap in tokens.

## 3. Principle (the design in one paragraph)

Pre-written, tested **actions** are the default. The model is skipped whenever code can decide. When the model is needed it returns only short JSON `{"action": "...", "params": {...}}` and **code** fills a template or calls a native function. Only when no action fits does the model write a PowerShell script, from small exact context, and that script passes a safety check first. Preference order: **native Electron call -> filled template -> AI-written script.**

```
command
 1. cache hit?                -> run saved action            (0 s)
 2. fast path (code only)     -> one clear match -> run      (<1 s)
                              -> a few matches  -> show 2-3 buttons, user clicks
 3. AI router (1 short call)  -> JSON action+params -> run   (~1-3 s on Groq)
 4. AI script fallback        -> safety check -> confirm -> run (rare)
```

## 4. Standing rules (apply to every stage)

1. **One stage per session.** Finish, test, update this file, stop.
2. **Keep the old flow working behind a flag** (`settings.speedMode`: `"old"` / `"new"`) so the user can compare. Do not delete old code until the user says the new system works.
3. **Only change files that need changing.** Keep the user's tone, colors and UI style.
4. **No new dependency without asking the user first.** No paid services.
5. **Keys never go in the project.** They live in `%APPDATA%\Executor\config.json`. Never write keys into this file, logs or source. Rotate any key the user pastes in chat.
6. **Correctness over speed.** Auto-run only when exactly one candidate clearly wins. If unsure, ask with 2-3 clickable options (still under 1 s). Never guess a destructive action.
7. **Destructive actions** (delete, move over something, registry, format, download-and-execute, shutdown, user/disk management) always need explicit confirmation showing exactly what will run. Deletes go through the existing trash/undo.
8. Be honest about what could not be tested. The cloud sandbox cannot run Electron on Windows: say so, and tell the user exactly what to try on their PC. Syntax-check with `node --check src/*.js`; `node db.test.mjs` should print `db: ok` (if the test file exists).
9. Be careful with the user's free credits: no large rewrites, no repeated re-reading of big files; read only what the stage needs.
10. Return the project as a zip (exclude `node_modules`, `out`, `.vite`, `installer/dist`).

---

## 5. Stages

Legend: `[ ]` not done, `[x]` done. Do them **in order**.

### Stage 0: Baseline and context `[x]`
Everything built before this plan: UI redesign, per-window themes, text-generate effect, slash menu and multi-agent (`/agent N [task, task]`), key/model rotation, recipes, installer, native rounded corners, "open browser and search" rule. Nothing to do. See "History" at the bottom.

---

### Stage 1: Measure first `[x]` (tooling done; the user's 10-command table is still to be collected)
**Goal:** know where the 20-60 seconds really goes before changing anything.

**Do:**
- Add a tiny timing helper (`t0 = performance.now()` style) around every stage of the current flow: prompt build, model call (and which provider/model, retries, key switches), response parse, command build, `.bat`/PowerShell startup, command execution, result handling.
- Write one JSON line per command to `%APPDATA%\Executor\timing.log`: `{ts, text, stages:{...ms}, modelCalls, ok}`.
- Add a small script `tools/timing-report.mjs` that prints an average table per stage.
- Run 10 sample commands (give the user the list to type, e.g. "open chrome", "open the movie mousetrap", "search elon musk net worth", "open my downloads folder", "play my dear by element on spotify", "what is my ip", "create a file test.txt on desktop", "open calculator", "set volume to 30", "open youtube").
- Show the user the table: where the time goes.

**Files likely touched:** `src/app.js` (loop), `src/main.js` (model call, run command), new `tools/timing-report.mjs`.
**Done when:** the user can run 10 commands and see a table with ms per stage. **Stop and show the table before Stage 2.** The table may change later stages.
**Result (2026-11-08):**
- Renderer (`loop()` in `app.js`) times: `promptBuild` (prefs + memory + PC context), `modelWait` (each `window.api.ai`), `parse`, `retryWait`, `cmdRun` (`window.api.run`), `find`, `launchApp`, `openPath`, `web`, `fileWrite`. Also `modelCalls`, steps, ok, fails, totalMs.
- Main (`main.js`): the `ai` handler now records every attempt (model, key number, ms, result `ok`/`timeout`/`error`/`http NNN`/`empty`), key switches, prompt size in chars, token `usage` if OpenRouter returns it. `runFile` records `.bat` write, `procExit` (cmd.exe start-up + command until it exits) and `exitGrace` (the fixed 350 ms wait after exit).
- New IPC `timing` (`start` / `log`). Main-side numbers wait per window and are merged into ONE JSON line in `%APPDATA%\Executor\timing.log` (rotates to `timing.old.log` at 5 MB). Exact repeats of a saved task are logged as route `saved`; everything else as `old`. Log contains your command text (local file only, no keys).
- New `tools/timing-report.mjs`: `node tools/timing-report.mjs` (optional path, `--last N`). Prints one row per command, average/median/max per stage with share of total time, model-call stats (attempts, key switches, prompt size, tokens, per-model average).
- Files touched: `src/app.js`, `src/main.js`, `src/preload.js`, new `tools/timing-report.mjs`, this file. Behaviour of the app is unchanged.
- Not tested: running the app (no Electron/Windows in the sandbox). Checked: `node --check` on the 3 edited files, and the report script against a hand-made log. `timing.log` is only written once you run commands in the real app.
- **Next session: before starting Stage 2, ask the user for the printed table from the 10 commands. It may change Stage 2-6.**

---

### Stage 2: Normalizer and intent parser (code only) `[x]` (built 2026-11-08, NOT yet run in Electron)
> (Gate waived: the user asked for all remaining stages in one go. Stage 1's table is still worth collecting to confirm the speed-up.)
**Goal:** understand simple commands without any model.

**Do:**
- New `src/fast/normalize.js`: lowercase, strip punctuation and filler words ("please", "can you", "the", "my", "for me"), ignore years.
- New `src/fast/intent.js`: find the verb (`open`, `launch`, `start`, `play`, `search`, `google`, `go to`, `show`) and the target text; return `{action, params, confidence}`. Confidence is a number 0-1.
- Add the setting `speedMode` (`old`/`new`, default `old` until the user flips it) in Settings (`src/tabs.js`) and `db` settings.
- No execution yet: just unit tests and a debug print of what it understood.

**Files:** new `src/fast/*.js`, `src/tabs.js` (setting), tests.
**Tests (Stage 2 owns these):** normalizer, intent verb extraction, confidence threshold with ~30 example commands (include typos and filler).
**Done when:** the 30 sample commands parse correctly and the old flow is unchanged when `speedMode` is `old`.
**Result (2026-11-08):** `src/fast/normalize.js` (lowercase, punctuation, filler phrases like "please / can you / for me", years; `{keepAll:true}` keeps every word for search queries) and `src/fast/intent.js` (`parseIntent(text)` -> `{action, params, confidence 0-1, normalized, reason}`; verbs open/launch/start/run/show/visit/watch/play/search/google/look up, typo-tolerant verbs, known apps, folders, sites, URLs, `... in chrome`, `open chrome and search X`; anything multi-step or destructive gets confidence < 0.75). `FAST_MIN = 0.75`. Setting `speedMode` (`old` default / `new`) is a checkbox in Settings > Speed (stored with `db` setting `speedMode`). Tests: `normalize.test.mjs`, `intent.test.mjs` (32 fast samples incl. typos/filler + 16 must-NOT-be-fast), `integration.test.mjs`. With `speedMode: old` nothing changed.

---

### Stage 3: Fast-path executors (native, no PowerShell) `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** run the common actions in under 1 second.

**Actions to implement (native Electron/Node first):**
`open_app`, `open_url`, `search_web` (use the user's default browser or the named one, e.g. `start chrome "https://www.google.com/search?q=..."` words joined with `+`), `open_folder`, `open_file` / `play_media` (open with the default player).
- Use `shell.openPath`, `shell.openExternal`, the existing `launchApp` and `find`. Avoid spawning `.bat`/PowerShell for these.
- Wire into `loop()` when `speedMode === 'new'`: run the intent parser, and if confidence is high and exactly one app/file matches, run it and print a short result. If 2-3 close matches: show clickable choices in the UI (reuse the existing `ask` + `options` buttons). If low confidence: fall through to the old flow.
- Keep the "ask first when the target is ambiguous" behavior (e.g. "play this song" with no app).

**Files:** `src/app.js` (hook in `loop`), `src/main.js` (small IPC helpers if needed), new `src/fast/actions.js`.
**Done when:** with `speedMode: new`, "open chrome", "open downloads", "search elon musk net worth" and "open the movie mousetrap" run in under 1 s with no model call, and ambiguous ones show buttons.
**Result:** `src/fast/actions.js` = native executors built by `makeActions(deps)` (Electron pieces injected, so tests use fakes): `open_app` (system apps via the shell, others via Start Menu lookup), `open_url`, `search_web` (words joined with `+`, default or named browser), `open_folder`, `open_file` (index/finder, one clear winner opens, 2-3 close matches become buttons, none = fall through), `open_path`. Program/script files (`.exe .bat .ps1 ...`) are never opened from a fuzzy match. `main.js`: `find` refactored into `findFiles()` (old `find` IPC unchanged), new IPC `fast`. `app.js`: `fastFlow()` runs when `speedMode === 'new'`; ambiguous = buttons (reuses the ask/options look), not understood = old loop runs as before; runner bar hides after window-opening commands. Bypassed for `!`-prefixed text, `/agent` team requests, script-writer and browser-agent windows.

---

### Stage 4: Command cache `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** a command that worked once never needs the AI again.

**Do:**
- After a successful run (fast path or AI), store `normalized command -> {action, params}` in the SQLite db (new table `cmd_cache`, with `uses`, `last_used`).
- Check the cache before everything else. Verify the saved params still valid (path still exists) before running; if not, drop the entry and continue normally.
- Settings page: a button to clear the cache. Never cache destructive actions.

**Files:** `src/db.js`, `src/fast/cache.js`, `src/app.js`.
**Done when:** running the same command twice makes the second run instant, and a deleted target is not run blindly.
**Result:** table `cmd_cache` + db ops (`cacheGet/Put/Use/Drop/Count/Clear`), `src/fast/cache.js` (key = normalized command; never caches destructive actions, `script`, or big params; every hit is re-validated through IPC `fastValid`: unknown action or missing path = entry deleted and the command continues normally). Ambiguity choices are cached after the user clicks. Settings > Speed shows the count and a Clear button. Order in `fastFlow`: cache -> code parser -> router -> script. Existing "saved .bat" memory (`reuseSaved`) is unchanged and still runs first. Tests: `cache.test.mjs`, db asserts in `db.test.mjs`.

---

### Stage 5: Fast providers (Groq first) and key hygiene `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** make the AI call fast and move keys out of the project.

**Do:**
- Provider list (config, not hardcoded): Groq, Cerebras (optional), OpenRouter free models. **Check each provider's current docs for endpoint, model names and limits; do not assume.**
- Per-call timeout 5 s, then fall to the next provider. Rotate on rate limit, timeout, empty output (extend the existing rotation in `main.js`).
- Keys read from `%APPDATA%\Executor\config.json` (`apiKeys` per provider) or env vars. **Remove keys from `default-keys.json`** and from the project; add a Settings > Keys UI for each provider (extend the existing keys page).
- Log token counts per call into `timing.log`.
- Optional, default OFF: race 2 providers for the AI path and take the first valid answer.

**Files:** `src/main.js`, `src/tabs.js`, `default-keys.json` (delete keys), `preload.js` if new IPC.
**Done when:** a short test prompt gets an answer from Groq in under about 2 s, falls back to OpenRouter when Groq is missing/rate-limited, and no key exists inside the project folder.
**Result:** `main.js`: provider list is config (`config.json` -> `providers`; defaults Groq `https://api.groq.com/openai/v1/chat/completions` models `openai/gpt-oss-20b`, `openai/gpt-oss-120b`; Cerebras `https://api.cerebras.ai/v1/chat/completions` model `gpt-oss-120b`; both checked against their docs on 2026-11-08; free limits there are small, e.g. Groq 8K tokens/min, Cerebras 5 req/min, so prompts must stay short). Per-call timeout 5 s, then next provider/key/model, rate-limited keys rest 60 s, then OpenRouter (router calls: max 2 OpenRouter attempts, 8 s each). Old-loop prompts over ~18k chars skip the fast providers. Optional race mode (setting `raceProviders`, default OFF). Keys: `config.json` `providerKeys.{groq,cerebras}` or env `GROQ_API_KEY` / `CEREBRAS_API_KEY`; Settings > Keys has a new "fast providers" section (IPC `pkeys`). **`default-keys.json` is now `{"apiKeys": []}`: the two OpenRouter keys that were in it are removed from the project. They were already copied to `%APPDATA%\Executor\config.json` on earlier runs. Because they travelled in zips, rotate them on openrouter.ai.** Token usage and provider are logged per call in `timing.log`.

---

### Stage 6: AI router (one short JSON call) `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** when the fast path is unsure, one tiny model call decides the action.

**Do:**
- Prompt = action names + one-line descriptions + the command. Nothing else. Model must return ONLY `{"action":"...","params":{...}}` or `{"action":"unknown"}`.
- Validate in code: known action, param types, paths exist (no path traversal). On invalid output: **one** retry, then ask the user.
- If the action has a native executor or template: run it in code. **Hard cap: 2 model calls per single-step command.** Multi-step tasks still use the old loop.
- Add the router result to the cache (Stage 4) after success.

**Files:** new `src/fast/router.js`, `src/app.js`.
**Tests:** JSON validator (bad JSON, unknown action, missing params, path traversal).
**Done when:** commands the fast path can't parse finish in under about 5 s with one call and run correctly.
**Result:** `src/fast/router.js`: prompt = action list lines + `script` / `old` / `unknown` + the command (+ one line with the user's folder paths, needed for "on desktop"). `validateRouterReply()` checks JSON, known public action, param types/ranges/enums, url scheme, full paths only, no `..`, `~` and `%VAR%` expanded first, allowed-folder rule is enforced again in main. Invalid -> ONE retry with the error, then the user is asked to rephrase (or use `!`). Provider down -> old loop. `old`/`unknown` -> old loop. Hard cap 2 model calls per fast-flow command (router + script). Successful router results are cached. Test: `router.test.mjs` (bad JSON, unknown action, missing params, traversal, outside folders).

---

### Stage 7: Action registry (folders) `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** adding an action = adding a folder.

**Do:**
- `actions/<name>/action.json` (name, one-line description, trigger keywords, params with types, `destructive`, `needs_ai`, path sections needed), `template.ps1` or a native function, `prompt.md` (short instructions, one example, common mistakes: quote paths, `-LiteralPath`, `Start-Process`).
- Loader reads all folders at startup. Migrate Stage 3 actions into it, and add: `create_file`, `read_file`, `list_files`, `copy_file`, `move_file`, `delete_file` (destructive, with confirmation and the existing trash), `set_volume`.
- **Make sure `actions/` is bundled** in the packaged app (`extraResource` in `forge.config.js`) and found in dev; test both paths.
- Write `docs/ADD_AN_ACTION.md`: how to add an action in under 10 lines.

**Files:** new `actions/*`, `src/fast/registry.js`, `forge.config.js`.
**Tests:** template filling (placeholders like `{{PATH}}`, quoting and escaping).
**Done when:** a new dummy action folder works with no other code change, in dev and packaged.
**Result:** `actions/<name>/{action.json, prompt.md, template.ps1}` for open_app, open_url, search_web, open_folder, open_file, open_path (internal), create_file, read_file, list_files, copy_file, move_file (destructive), delete_file (destructive, goes to the Recycle Bin), set_volume (template; presses the media keys, approximate, 2% steps). `src/fast/registry.js` loads the folders at startup (a broken folder is skipped and logged to `genisys-debug.log`), validates params, fills templates (`{{NAME}}`, single-quote escaping incl. curly quotes, line breaks refused). `forge.config.js`: `extraResource: ['assets', 'actions']`; dev path is `../../actions` from the build folder. Destructive actions return `confirm` with the exact preview and only run after the page asks. `docs/ADD_AN_ACTION.md`. Test: `registry.test.mjs` loads the real folder and a dummy folder on a fake disk. NOT tested: the packaged path (`process.resourcesPath/actions`); check `genisys-debug.log` for the line "actions loaded: ...".

---

### Stage 8: Path index (sections, never sent whole) `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** instant, correct path lookup, and tiny AI context.

**Do:**
- Background scanner (low priority, incremental, light on RAM) builds cached sections: `installed_apps` (exact exe path + launch method), `personal_files`, `media_library`, `system_files`. Skip junk: `node_modules`, `.git`, AppData caches, system folders. Store name, lowercase name, full path, extension, type, size, modified.
- `my_paths.json` in `%APPDATA%\Executor` lets the user pin paths that always win.
- Fuzzy lookup returns the top 3 candidates with exact paths, ignoring case, punctuation, years, filler words (reuse `fuzzy.js`).
- Fast path and router use it; only the relevant section is ever sent to a model.

**Files:** new `src/fast/index.js`, `src/main.js` (scanner worker), `src/fuzzy.js`.
**Tests:** path lookup, pinned paths win, junk folders skipped.
**Done when:** "open the movie X" resolves from the index in well under 100 ms, and scan CPU/RAM stay small.
**Result:** `src/fast/index.js` (`PathIndex`): sections installed_apps, personal_files, media_library, system_files; skips node_modules/.git/AppData/caches/system folders; incremental (unchanged folders reuse the saved listing); yields to the event loop; cached in `%APPDATA%\Executor\path-index.json`; started 15 s after launch, refreshed after 6 h or from Settings > Speed > Rescan. `my_paths.json` (Settings > Speed > My paths) pins names to paths that always win, `roots` adds folders to scan. Lookup: all words in name/folders = instant; only if that finds nothing, a letter-pair typo pass. Size/modified are stored for media files only (stat on every file was too heavy). The fast path and `resolveApp` use it first and fall back to the live finder. Only the few relevant paths are ever given to a model (`contextFor`). Test: `index.test.mjs` (junk skipped, pins win, incremental, typo, episode, round trip, speed). Real-disk timing and CPU/RAM not measured.

---

### Stage 9: AI script fallback + safety checker `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** keep flexibility for rare commands, safely.

**Do:**
- Only when no action fits. Send the AI: the relevant path section(s), the single most similar recipe/prompt.md as an example, and the command. Rules: use ONLY paths in the context, never invent one, output one PowerShell script in one code block with no explanation, or exactly `NOT_FOUND: <what is missing>`.
- Extract the script from the code block only. Never use `Invoke-Expression`. Run the safety checker before executing: block or require confirmation for `Remove-Item`, `Format-`, registry writes, download-and-execute, `Stop-Computer`, user/disk management; check every path with `Test-Path`; restrict file actions to configurable allowed folders.
- Destructive scripts always ask for confirmation showing exactly what will run.
- On failure: retry once with the error and the same small context (counts toward the 2-call cap).
- Log every AI-written script and result. Add a command/Settings view listing scripts that succeeded 2+ times so the user can promote them to `actions/`.

**Files:** new `src/fast/safety.js`, `src/fast/scriptFallback.js`, `src/app.js`.
**Tests:** safety checker (dangerous patterns, missing paths, injection through quotes).
**Done when:** a dangerous script is blocked or confirmed, a valid one runs, and the promotion list works.
**Result:** `src/fast/safety.js` + `scriptFallback.js`. Router answer `script` -> one call with CONTEXT (relevant paths only) + the most similar `prompt.md` + the command; only a single code block is used (`NOT_FOUND: ...` supported). Checker (runs in the page for the preview AND again in main right before running): BLOCK Invoke-Expression/iex (also through backticks and `'i'+'ex'`), encoded commands, runtime-built commands, disk/boot/user management, shutdown, registry writes, RunAs, security settings, download-and-run, ".." paths, deleting or writing outside allowed folders, paths that don't exist (a single NEW file in an existing folder is OK); CONFIRM delete/move/overwrite, stop-process, downloads. Every AI script is shown and needs Run/Skip even when it looks safe (my choice: rare path, so safety over speed). One retry with the error is allowed only if the 2-call cap has room. Every script and result is stored in table `scripts`; Settings > Speed lists those that worked 2+ times with a copy button. Test: `safety.test.mjs`, `scriptFallback.test.mjs`. Not a sandbox: a determined script can still slip past a regex filter.

---

### Stage 10: Logging, comparison and stats `[x]` (built 2026-11-08, NOT yet run in Electron)
**Goal:** prove it is faster and still correct.

**Do:**
- Per command log: text, route (`cache` / `fast` / `router` / `script` / `old`), action, provider, generated script, timing per stage, result, success/failure, tokens.
- `tools/stats.mjs`: success rate and average time per route, per action, per provider, and **old flow vs new flow**.
- Settings page: a simple read-only "Speed" panel with the same numbers.

**Done when:** the user can run the same 10 commands in `old` and `new` mode and see a before/after table.
**Result:** every command writes one `timing.log` line with `route` (`cache|fast|router|script|saved|old`), `mode` (`old|new`), `action`, provider/model/tokens per AI call, script (if any), stage timings, ok. `src/fast/stats.js` + `tools/stats.mjs` (`node tools/stats.mjs`): success rate and average time per route, mode, action, provider, and a "same command, old vs new" table. Settings > Speed shows the same text. To get the before/after table: type the 10 commands with Fast mode OFF, then ON, then run `node tools/stats.mjs`. Test: `stats.test.mjs`.

---

### Stage 11: Final tests, cleanup and docs `[x]` (built 2026-11-08, NOT yet run in Electron)
**Do:**
- Make sure all tests from Stages 2-9 pass in one command (`npm test` or a script; no new dependency without asking, use Node's built-in `node:test`).
- Final before/after timing table (from Stage 1 vs now).
- Update this file's section 1 ("How a command works") to the new flow.
- Known weaknesses list. Only after the user confirms the new flow works, offer to remove dead old-flow code (do not do it without being told).

**Done when:** the user is happy with the speed and everything above is ticked.
**Result:** `npm test` runs every `*.test.mjs` with Node's built-in runner via `tools/run-tests.mjs` (no new dependency; `db.test.mjs` is skipped automatically on a Node without `node:sqlite`). 136 tests pass in the sandbox. Section 1 below describes the new flow. **Known weaknesses:** (1) nothing has been run inside Electron/Windows yet; (2) `set_volume` is key-press based (approximate, needs an audio device); (3) the safety checker is regex-based, not a sandbox; (4) free-tier limits of Groq/Cerebras are small, so busy periods fall back to OpenRouter (slow); (5) the typo pass of the index scans every name (fine for tens of thousands of files, slower beyond); (6) `play X on spotify/youtube` is not fast-pathed (needs app control) and goes to the old loop; (7) `open_app` for unknown names costs one failed lookup before the old loop runs; (8) fast-flow results are shown as simple rows, not the animated live card; (9) the router adds 1-3 s to commands that the old loop would have handled anyway when it answers `old`. Dead old-flow code is NOT removed: do that only after the user confirms the new flow works.

---

## 6. Things deliberately NOT in scope
- Screenshot / computer-use style agents, long multi-step reasoning loops for simple commands.
- Parallel provider racing as a default, paid services, big rewrites.
- Changing the UI look, colors or the user's Gen Z tone.

## 7. Known facts and gotchas
- Free OpenRouter models are slow (5-15 s a call) and rate-limited; that is the main reason for 30+ s.
- `electron.exe` is a windowed program: running it directly in cmd returns immediately and prints nothing. Don't use that as a test.
- The user's app once failed to start from an OneDrive folder / mixed files; the project now lives in a plain folder (`C:\DEV-PROJECTS\...`). Do not assume OneDrive.
- `Alt+Space` runner bar: also a normal window mode (`mode=runner`); fast path should work there too and the bar should hide after window-opening commands.
- Multi-agent: `/agent N [task, task]` opens N agent windows; children report back with `agentDone`; children cannot spawn agents. Don't break this.
- The "open <browser> and search X" rule must keep working: the browser must show the search (`start chrome "https://www.google.com/search?q=..."`).

## 8. Change log

| Date | Stage | What changed | Files | Not tested |
|---|---|---|---|---|
| 2026-11-08 | 0 | Plan written; baseline described | `PROJECT_CHANGELOG.md` | n/a |
| 2026-11-08 | 2-11 | All remaining stages built in one session at the user's request: parser, native executors, cache, providers (Groq/Cerebras/OpenRouter), router, action registry, path index, script fallback + safety, stats, 136 tests, keys removed from `default-keys.json` | `src/fast/*`, `actions/*`, `docs/ADD_AN_ACTION.md`, `tools/*`, `src/main.js`, `src/app.js`, `src/preload.js`, `src/tabs.js`, `src/db.js`, `src/db.test.mjs`, `forge.config.js`, `package.json`, `default-keys.json`, `PROJECT_CHANGELOG.md` | Everything inside Electron on Windows (see Stage 11 weaknesses) |
| 2026-11-08 | 5 (follow-up) | At the user's request the 3 Groq keys live in `default-keys.json` (`providerKeys.groq`), seeded once into `%APPDATA%\Executor\config.json` at startup. This undoes the "no keys in the project" rule for these keys by the user's choice: do not zip/share the project with that file, and rotate the keys if it ever leaves the PC. | `default-keys.json`, `src/main.js`, `PROJECT_CHANGELOG.md` | Not run in Electron |
| 2026-11-11 | 1.3.1 | Themed dropdowns everywhere (`src/select.js`: every `<select>` and `<input list>` gets the app's own list, the real select stays hidden and keeps value/change). Typo search: Damerau edit distance per word ("recieve", "resme", "pakage json") + a letter-pair table (typed arrays, built after each scan) so typos are found across the whole PC in ~15–120 ms. "open whatsapp": Store apps (Get-StartApps → shell:AppsFolder) are found and launched; app-or-site names open the installed app, the website only if missing or asked for; Store apps show in /search. Speed: AI requests are hedged (a key that hasn't answered in 2.5 s gets a second one alongside), OpenRouter step timeout 20 → 12 s. Chat: no "Thought 0.0s" steps, the fast route shows its row only when it really did something. | `src/select.js`, `src/fuzzy.js`, `src/fast/index.js`, `src/fast/intent.js`, `src/fast/actions.js`, `actions/open_app/action.json`, `src/main.js`, `src/app.js`, `index.html`, tests | Launching a Store app by hand in the installed build |
| 2026-11-11 | extra (search) | /search header: Type dropdown (All, Folders, Documents, Images, Media, Apps; Ctrl+P) and Modified dropdown (Any time, Today, Past 7/30 days, Past year; Ctrl+M), in-page so the Alt+Space bar keeps focus; the date filter checks the best 300 name matches on disk (18–240 ms). Recent searches: Clear button + "Remove from recent". | `src/app.js`, `src/main.js`, `src/preload.js`, `index.html` | Dropdowns by hand in the real window |
| 2026-11-11 | extra (keys/editor) | "Your own AI" in Settings › Keys: user key for Claude (official `@anthropic-ai/sdk`, models claude-opus-5-5 / sonnet-5-5 / haiku-4-5 / fable-5-1, effort low/high, server-side refusal fallback), OpenAI, Gemini, DeepSeek, Mistral, OpenRouter or any OpenAI-compatible URL; live model list, Test, "Use this model"; used first for every AI call, free chain on failure (one notice per 10 min). Settings is now a centred popup over a blurred backdrop. Script Writer "Folder": explorer tree (search, open editors), a tab per file, breadcrumbs; AI code opens as its own tab, Save-as starts in the folder; the AI sees the folder's file list. AI answers with code now use a `code` field (was dropped when asked to put it in "say"). | `src/main.js`, `src/preload.js`, `src/tabs.js`, `src/editor.js`, `src/app.js`, `index.html`, `package.json` | A real Claude/OpenAI key end to end; the real folder dialog |
| 2026-11-11 | extra (UI) | Agent chat redesign after shadcn.io/ui "AI" patterns, in plain DOM (`src/agentui.js`, `src/codeblock.js`): the live card is now a trace that folds into "Done in N steps · 6.2s" (was removed at the end), step outputs one level down (file tree for finds, site chips for searches, command output in dev), Thinking → Thought with the AI's "decided" inside, plan count in the trace header (old plan box removed), Deny / Approve confirmation with the exact command (replaces run/skip), `[n]` citation chips, changed-files card (2+ files, A/M/D/R with +/−; new `readText` IPC), `.env` card with masked values, team card as Working / Done queue, code blocks with copy. Script Writer: one shared buffer (no tabs, click the name to rename), the AI writes into it and never to disk, Save = Windows "Save as" dialog the first time, Open (Ctrl+O) loads any file, chat panel hidden by default (Chat / Ctrl+J; questions, confirmations and errors open it), prompt bar under the editor, centred 1040×900 window capped to the screen, extra icons hidden. | `src/app.js`, `src/agentui.js`, `src/codeblock.js`, `src/editor.js`, `src/main.js`, `src/preload.js`, `index.html` | Real AI runs end to end (checked with hand-built DOM in the browser preview) |
| 2026-11-11 | extra | `/search` in the `/` drop-up: live results from a new whole-PC tree (`pc-index.json`, every drive, separate from the user-folder `path-index.json` the AI uses), filter (Ctrl+P), double-click opens, right-click / Ctrl+K menu (Open, Open file location, Copy, Cut, Copy path, Rename, Delete → Recycle Bin), AI rewrite only when a 3+ word query finds nothing. Both trees rescan at start + every 5 min. Lookup keys precomputed + 400 ms deadline (searches 1–50 ms, no-match ≤ ~420 ms). Autostart: the forge `out\` build no longer overwrites the installed app's Run entry; start log records argv. | `src/fast/index.js`, `src/fast/index.test.mjs`, `src/main.js`, `src/preload.js`, `src/app.js`, `index.html` | Copy/Cut paste in Explorer, Rename, Delete and the AI fallback by hand; a reboot autostart |
| 2026-11-08 | 1 | Timing in loop + ai/run handlers, `timing` IPC, `timing.log`, `tools/timing-report.mjs` | `src/app.js`, `src/main.js`, `src/preload.js`, `tools/timing-report.mjs`, `PROJECT_CHANGELOG.md` | Running in Electron; real log output |
| 2026-11-12 | training | ~400 real-user phrases played through the code parser, misfires fixed, zero-AI coverage widened. Fixed: "open the folder called X" kept "called"; "close chrome and open edge" closed an app named "chrome and open edge"; "search wikipedia for X" searched Google for the whole line; "search for resume.pdf" went to the web; "open chrome in incognito" / "open latest download" / "open the pdf called resume" / "show hidden files" launched nonsense app names; "kill all chrome processes" looked for an app with that name; "what is a pdf" listed files. New zero-AI: "opn chrome" (3-letter typos), "open c:" / "open d:\x" / "open c drive" (open_path), typed files ("open excel file budget"), weather and quick math via a Google search, time/date (`clock`), `recycle_bin`, `specs` (CPU/GPU/RAM/Windows), `wifi_password`, CPU name in the cpu answer, "increase/decrease/max volume", "turn up the volume", "set volume at 80 percent", "check for updates", "connect to wifi", "change wallpaper" (settings pages), "sign out of windows", "go back a song", "what gpu/windows do i have", "am i charging", "how much storage do i have left", "files i downloaded yesterday", stackoverflow / news / bbc / tiktok and a few more sites. 29 new tests. File tables follow the user's rules: "only 10" / "just 5" / "7 is enough" / "5 max" / "show me 10 movies" / "a few" set the row limit (was 278 rows for "only 10"); "last 10" means newest first; a bare year filters ("2025 photos"); the table is Name + date only, and Size / Type / Folder columns appear only when asked for ("with sizes", "where they are", "by type") or implied (sorted by size) — new `show` param on `browse_files`. Follow-up: the fast flow now runs the code parser BEFORE the command cache (the cache remembers AI decisions; it must never shadow what the code understands — it replayed a 278-row answer after the parser was fixed). File requests are read as slots found anywhere in the sentence, not fixed phrases: any plain number that is not a year / size / time span / episode is the count; "old / oldest / earliest" vs "new / latest / recent" sets the order; "i have / i got / on my pc" means this PC (so "search movies i have old films only 10" no longer goes to Google). The word lists live in one exported `WORDS` table in `src/fast/fileQuery.js` to extend. | `src/fast/intent.js`, `src/fast/system.js`, `src/fast/fileQuery.js`, `src/fast/files.js`, `src/fast/actions.js`, `actions/pc/action.json`, `actions/search_web/action.json`, `actions/browse_files/action.json`, tests | Inside Electron (controls were run through `makeSystem` with real PowerShell on this PC: clock, cpu, specs, wifi_password all answered) |

## 9. History (before this plan)
Rounded native windows, per-window themes, shadcn-style text generate effect (only on special answers), slash menu and multi-agent orchestration, `/agent N [task, task]`, "open browser and search" prompt rule, startup diagnostics (`%TEMP%\genisys-debug.log`), key/model rotation, recipes (138), installer (Inno Setup), animated dot background, globe/orb UI, memory/profile, todo widget.
