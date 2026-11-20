# Genisys fix tracker: "says deleted, but the files are still there"

Evidence (your chat): "delete last 3 zip folder in downloads" -> "Trashed 3 zip files" -> next listing still shows 3 zips
-> "delete them" -> "already in the Recycle Bin" -> "Recycle Bin emptied" -> listing STILL shows them -> "already deleted".

## All possible causes
| # | Cause | Status |
|---|-------|--------|
| A | The AI states file state from its own chat memory and never re-checks the disk | Stage 1 (prompt rule) |
| B | Success is claimed without checking: `shell.trashItem` result trusted, `Clear-RecycleBin ... SilentlyContinue` hides failures, changes card built from claims | Stage 1 (disk check + count check) |
| C | "last 3" is ambiguous (newest or oldest), and the files trashed were never named to you | Stage 1 (rule: N newest, name the files) |
| D | "them/those" binds to the earlier delete, not the latest listing: AI turns are left out of the conversation block, no order, no "latest listing" marker | Stage 2 (done) |
| E | The fast path lists but never feeds rows back so "delete them" can be answered in code from the latest listing | Stage 2 (done) |
| F | Folder resolution: "videos/movie folder" fuzzy-matched MEMES; "in movies" went to the Videos root; fuzzy "many" takes the first match | Stage 3 (done) |
| G | Folder index can be stale (6 h) while file listing is live | Stage 3 (done: rescan on every listing) |
| H | Real-world: file in use / protected / OneDrive placeholder, or it was a different file than you think | Stage 1 reports it ("still on disk") |

## Stages (do one, test on Windows, then ask for the next)
- [x] **Stage 1: delete tells the truth** (DONE)
  - main.js `trash`: checks the path exists first, trashes, then checks it is really gone; reports `not found` / `still on disk` instead of ok. Rescans the index in the background.
  - system.js `empty_recycle_bin`: runs, then COUNTS items left in the bin; only says "emptied" if it is empty, otherwise errors.
  - app.js AI prompt: never trust memory for file state, re-check now; "last N" = N newest; name the files; say "deleted" only if the result says VERIFIED; results text now says VERIFIED / NOT deleted with names.
  - How to test (Windows): put 3 test zips in Downloads, say "delete the last 3 zips". The result must name the 3 files and they must be gone. Then "delete those" must NOT say "already deleted". Lock a file (open it) and try: it must say it is still on disk.
- [x] **Stage 2: follow the current conversation** (DONE)
  - convo.js: the conversation block now keeps AI turns (app.js no longer skips them), in time order, and marks the MOST RECENT LISTING as what "them/those/these/it" mean (its rows are always kept). The header says a listing after a delete proves the items exist.
  - convo.js: `deleteRef(task)`: "delete them / those / these / it / all of them" -> exactly the paths of the latest listing. Returns nothing (so the AI asks) when there is no listing, a row has no path, or the listing was longer than the rows kept (10).
  - app.js: that case runs in code, before the parser: confirm card with the exact paths -> trash -> disk check -> names of what is gone and what is NOT deleted. Recorded as a turn.
  - app.js: AI delete turns are recorded as `trashed` with the checked names, so later answers see what really happened.
  - Tests: convo.test.mjs (+3: the zips chat, refusals, prompt order and marker).
  - How to test (Windows): "show me all zip folders in downloads" then "delete them": a card must list those exact 3 paths. Approve: it names them, they are gone in File Explorer. Say "delete them" again: it says not found / nothing deleted, never "emptied". "delete the first one" must still ask or act on that one, not all.
- [x] **Stage 3: folder resolution + rescan** (DONE)
  - actions.js `folderOf`: `videos/movie folder` is split into parts and walked through REAL folders. A name matches exact > singular/plural > prefix > contains, with a small typo allowance. A real subfolder (Videos\Movies) wins over the library alias; the alias (movies -> Videos) is only the fallback. The old "take the first fuzzy match" is gone: a search hit is used only if its folder NAME fits, so "movie" can no longer land in MEMES; no fit = "no folder ... on this PC".
  - fileQuery.js: "in movies" (with or without "folder") keeps the word `movies` instead of turning it into the Videos library, so folderOf can find Videos\Movies.
  - Rescan: every file listing calls `refreshIndex` (main.js: background rescan of the folder tree, at most once a minute) and reads the disk live. Trash also triggers it (Stage 1).
  - Tests: actions.test.mjs (+3), intent.test.mjs (+1).
  - How to test (Windows): "show me latest movies in videos/movie folder" and "show me in movies" must both list C:\Users\<you>\Videos\Movies (not MEMES, not the Videos root). "show me videos in movie night" must say there is no such folder.
- [x] **Stage 4: replay + regression** (DONE)
  - `src/fast/replay.sim.mjs` replays your exact chat (the 5 file requests, then the zips and "delete them") through the real parser, actions and conversation memory on a fake disk. Run: `node src/fast/replay.sim.mjs` (prints "replay passed").
  - Full test suite: everything passes except `files.test.mjs`, which fails on Linux only because of a Windows-path fixture (same on your original zip).
  - Not testable here: the real model and the Windows main process (Recycle Bin, disk check). Test those with the Windows checks listed in Stages 1-3.

## ALL STAGES DONE. If something still misbehaves on Windows, paste the chat and name the stage whose check failed.

Last updated: all 4 stages complete.

---
# Round 2: "open gmail in kevin chrome profile" opened a fresh, signed-out Chrome (DONE)
Causes: (1) no browser-profile support: Chrome was started with no `--profile-directory`, so it opened a new profile; (2) "gmain" (typo) and "chatgpt deskrop app" (typo) missed the fast path and went to the AI, which searched in circles for 116 s; (3) the "memory offline" line did not say the AI model was unreachable (you typed the same question 4 times, each time the model call failed).
Fix:
- main.js `browserProfiles()`: reads Chrome/Edge/Brave `Local State` (profile names + accounts). Chrome profiles are also listed in the AI's PC CONTEXT.
- intent.js: "in kevin chrome profile", "in kevins chrome", "with my work profile" -> `profile` param; one-typo site names (gmain -> gmail); "chatgpt deskrop/desktop app" -> the app, else the website.
- actions.js: `open_url` / `search_web` accept `profile`: starts `chrome.exe --profile-directory="Profile 1" <url>`. Unknown name = no launch, and the reason lists your profiles.
- AI prompt: rule to use that action for profile requests, and not to hunt for a missing desktop app again and again.
- The offline line now says the AI model can't be reached.
Test (Windows): "open gmail in kevin chrome profile" must open Gmail already signed in. "open chatgpt deskrop app" opens the app, or chatgpt.com at once if it is not installed.
Not done: agentic work INSIDE Gmail (reading/sending mail, clicking around). That needs browser automation or the Gmail API.

---
# Round 3: wrong profile, "search gmail" = Google search, no favorites, bad header (DONE)
Causes found in your chat:
1. "no chrome profile called Kevin" although KEVIN exists: the folder named `kevin` (Person 1) scored the same as the profile NAME KEVIN, so the match was a tie. Fix: the name you see in Chrome counts most, then account, then folder name; typos allowed (kevn = Kevin).
2. The AI then guessed profile "Nshimyimana" and ran a Google search for the word "gmail". Fix: "open kevin chrome profile and search gmail" is understood in code = open the Gmail inbox (https://mail.google.com/mail/u/0/#inbox) in that profile; the AI is told never to guess a profile and that "search gmail" means open it.
3. No favorites. New: src/fast/favorites.js + `prefs` table (DB) + the `favorite` action.
   - Say: "my favorite browser is chrome", "make kevin my default chrome profile", "my email is outlook", "i use spotify for music", "forget my favorite email", "what are my favorites".
   - Favorites only fill what a request leaves out: "search cats" goes to your favorite browser+profile; "open my email" opens your favorite email app (default Gmail). Anything you NAME (a browser, a profile, an app) wins and the favorite is skipped; a favorite profile belongs to its browser, so "in edge" never gets chrome's profile.
   - It also learns: 3+ uses and a 60% share make a choice a favorite without being told. Favorites are listed to the AI in its PC context.
4. "write email and sent it": compose_email opens a Gmail draft (to/subject/body filled, in the right profile). It NEVER says sent (you press Send). It refuses missing or placeholder recipients (example.com). The AI prompt says the same.
5. Header: the brand was a white block, two icons, a bordered DONE box, the New chat pill in the middle. Now: one mark (the orb), "genisys" as plain wordmark, a thin divider, the chat title first and the host quiet, then on the right a soft status pill (dot + Done/Working/Ready/Error), the model, an icon-only New chat, close. Checked in dark and light.
Tests: favorites.test.mjs (6), intent.test.mjs (+1, fixed the old expectations for the new Gmail URL). Not testable here: real Chrome profile launching on Windows and the real model.
Test (Windows): "my favorite browser is chrome" then "make kevin my default chrome profile"; "search cats" must open in Chrome, profile KEVIN. "open kevin chrome profile and search gmail" must open the Gmail inbox signed in. "search cats in edge" must NOT use Chrome's profile.

---
# Round 4: "open spotify" opened Chrome, "kevin cv.pdf" would not open, "open it" lost the conversation

## Stage 1: the three bugs from this chat (DONE)
- [x] **Spotify -> Chrome.** Cause: your Spotify is a Chrome app. Its Start-menu shortcut is `chrome_proxy.exe --profile-directory=Default --app-id=...`. The app read only the shortcut's target and dropped the arguments, so plain Chrome opened. Fix: `src/fast/shortcut.js` (`shortcutLaunch`): a shortcut WITH arguments is started as the shortcut itself (main.js `launchTarget` uses `cmd /c start "" <shortcut>`); used by both `resolveApp` and the app index. Tests: shortcut.test.mjs.
- [x] **kevin cv.pdf would not open / could not be uploaded.** Cause: `create_file` wrote the text under a .pdf name, which is not a PDF. Fix: a .pdf is now printed by Chromium in a hidden window (main.js `writePdf`), from the text laid out by `src/fast/doc.js` (# title, ## heading, - bullets, **bold**), then CHECKED after writing (starts with `%PDF-`, same size back). .docx/.xlsx/.pptx/.zip are refused (they would be broken files) instead of faked. Tests: doc.test.mjs.
- [x] **"then open it" -> "didn't catch that", "its not opening why" -> opened Gmail again.** Cause: created files were not remembered as rows, and "it" had no owner. Fix: created files are recorded as the turn's rows; `convo.openRef` makes "open it / open that file / open the pdf" open exactly that one file in code; the AI prompt says "it" = the subject of the LAST turn and that "not opening" means CHECK THAT FILE (exists, size, header bytes) and never repeat an earlier task. Tests: convo.test.mjs.
- Windows checks: "open spotify" opens Spotify (not Chrome). "create file pdf called kevin cv in documents ..." then "open it": the PDF opens with real text. "open it" after a list of several files must ask which one.
- Not testable here: the real PDF print and the real shortcut launch (they need Windows + Electron).

## Plan: "predict what to open" instead of hard-coded lists (Stages 2-6, not started)
Idea: "open X" is not one thing. X may be an app, a Chrome app, a Store app, a file, a folder, a website, a setting. Today code guesses with lists (KNOWN_APPS, SITES). Instead: know everything that is on this PC, score every candidate for the sentence, and take the highest score; ask only when two are close.
- [x] **Stage 2: the catalog ("know my PC")** (DONE)
  - New DB table `catalog` (db.js): id `kind:launchkey`, kind (app/pwa/store/program/site/file/folder), name, aliases, launch, source, uses, last_used, misses, label (for Stage 4).
  - `src/fast/catalog.js` (pure): ids, aliases derived from the name + how common each word is on YOUR PC (no name lists), merge keeps uses/last_used, an item is removed only after 2 scans in a row without it and only if its scanner ran, `candidates()` = typo-tolerant retrieval (letter triples + prefixes).
  - `src/fast/catalogScan.js` (pure): Start-menu shortcuts WITH arguments (Chrome apps -> kind `pwa`, e.g. Spotify), Store apps, registry-installed programs, Chrome/Edge/Brave bookmarks per profile, Windows Recent files/folders.
  - main.js `refreshCatalog()`: runs 9 s after start and every 30 min. Nothing uses it for decisions yet (that is Stage 3), except usage counting: opening an app through Genisys adds +1 use.
  - New command (no AI): `catalog`, `catalog spotify`, `rescan catalog`.
  - Tests: catalog.test.mjs (new), +1 actions, +1 intent. Full run 231 pass / 1 fail (files.test.mjs, old Windows-path fixture failure).
  - Not testable here (needs Windows): the real scanners, registry PowerShell, Recent folder.
  - How to test (Windows): start the app, wait ~15 s, type `catalog`: it says "I know N things: x app, y pwa, z store, ...". Type `catalog spotify`: Spotify must show as `pwa` (or `store`) with its launch path. Try `catalog spotfy`, `catalog vsc`, `catalog kevin cv`. Open an app, then `catalog <app>` shows "(opened 1x)". If counts are 0, tell me what `catalog` prints and the last lines of %TEMP%\genisys-debug.log ("catalog:" line).
- [x] **Stage 3: the predictor** (DONE)
  - `src/fast/predict.js` (pure): `score = nameMatch * (0.7 + 0.3 * prior)`.
    - nameMatch survives typos: edit distance, sounds-alike (consonant skeleton: spotfy = spotify), letter triples, prefixes, joined words (visualstudiocode), whole-query coverage.
    - prior = kind (learned from what YOU open, plus a small base: apps > programs > sites), how much you use it, how recently, whether it is a favorite, whether the conversation just named it.
    - Installer/updater/helper entries are pushed down (generic words, not app names).
  - Decision: top >= 0.62 AND 0.12 ahead of the best DIFFERENT thing -> open it. Otherwise a choose card with up to 3 close ones. Nothing close -> falls through to the old path (resolveApp, then the AI). The same name under two kinds (Spotify app + Spotify program) is not a rival.
  - `open_app` (actions.js) now predicts from the catalog before the old lookup; it starts the entry the way its kind needs (shortcut with arguments, Store app, program, or a bookmark in its own Chrome profile) and says kind + confidence: "opened Spotify (pwa, 81% sure)". Choose-card buttons open that exact entry.
  - New command: `predict spotfy` or `why open spotfy` prints the ranked list with each score, name part and prior, so you can see why.
  - Tests: predict.test.mjs (new, 7), +1 actions, +1 intent. Full run 240 pass / 1 fail (files.test.mjs, old Windows-path fixture failure).
  - Not testable here: real catalog contents (needs Windows). Scores were tuned on a fake list of ~15 apps; real PCs have hundreds, so weights may need adjusting after you try it.
  - How to test (Windows): wait ~15 s after start, then `predict spotfy` (top should be Spotify, DO), `predict whatsap`, `predict vsc`, `predict zzzz` (NONE). Then `open spotfy`, `open spotify`, `open discrod`: each should open the right app and say the kind and %. `open one` or any ambiguous word should show a choose card. If something is wrong, send me the `predict <word>` output.
- [x] **Stage 4: the model labels your PC** (DONE)
  - OFF until you say `label my pc` (that is your consent; `stop labeling my pc` turns it off). Only app NAMES are sent (apps, Chrome apps, Store apps, programs). Never files, folders, paths, bookmarks or file contents.
  - `src/fast/label.js` (pure): batches of 25 names -> the model returns category (browser, email, chat, music, notes, editor, ...), up to 3 other names / misspellings, and typical verbs. Every answer is checked; bad rows are dropped, never guessed. Labels are cached by a hash of kind+name, so an app is asked about once (again only if renamed).
  - main.js `labelCatalog()`: runs on `label my pc` (up to 200 apps) and after each catalog refresh (up to 50 new ones). Uses the same AI path as the router (your own model first, then the free ones).
  - predict.js now also matches the model's aliases and category word ("open browser" -> your browser).
  - At question time: when the predictor is unsure between a few close apps, ONE tiny ask (names only, max 12 tokens, 4 s) picks the best, or says none. "none", failure, or labeling off = the choose card as before. A clear winner never costs a model call.
  - `catalog` now shows how many apps are labeled; `catalog <word>` shows each match's category.
  - Tests: label.test.mjs (new, 7). Full run 247 pass / 1 fail (files.test.mjs, old Windows-path fixture failure). The real model is not tested here: only the code around it, with a fake model.
  - How to test (Windows, needs a working AI key/model): type `label my pc`. It says how many apps it labeled. Then `catalog` shows "Model labels: N apps labeled". `catalog brave` (or any app) shows `[browser]` etc. Try `open browser`, `open the notes app`, and an ambiguous word like `open one` (the message should say "picked by the model" when it chose for you). `stop labeling my pc` stops all sending.
- [x] **Stage 5: learn from outcomes** (DONE)
  - New DB tables `learn` (per typed request + catalog entry: wins/losses) and `confusions` (readable log).
  - Every predictor open counts as a win for "this request -> this entry" (kept unless you object). After 1 win that request maps to that entry (0.9), after 3 it is as good as an exact name. This is how "spotfy" becomes Spotify for good.
  - `no` / `no, the other one` / `wrong one` / `not that`: counts a loss for the last pick (that request then ranks it lower), logs it, and opens the next best (or a choose card). `no, I meant notepad` / `not that, open notepad`: opens that, teaches the original request (+2), logs it. Only works within 10 minutes of the last open; otherwise it is left to the AI.
  - Choose-card clicks teach the request too.
  - `confusions` / `show my mistakes` / `what did you get wrong`: shows the log.
  - Predictor opens are no longer cached in the route cache (a cached wrong pick could repeat forever).
  - Fixed: an exact name ("Spotify") now beats a derived short name of a longer one ("Spotify Beta").
  - Not built: noticing that you closed the window right after it opened (would need process watching). Saying "no" is the signal. It cannot close the wrong app it already opened.
  - Tests: learn.test.mjs (new, 6). Full run 253 pass / 1 fail (files.test.mjs, old Windows-path fixture failure).
  - How to test (Windows): `open spotfy` -> if right, say nothing; if wrong, say `no, the other one` or `no, I meant spotify`. Then `open spotfy` again: it should pick the corrected one. `show my mistakes` lists what was learned.
- [x] **Stage 6: replace the lists + measure** (DONE) ROUND 4 COMPLETE
  - The parser (intent.js) no longer has an app list (KNOWN_APPS is gone). Any short name after "open" goes to `open_app`, and the catalog + predictor decide. Qualified or long requests ("open chrome in incognito", "open 3 chrome windows", "open chrome settings") still go to the AI.
  - Known website names (youtube, gmail, netflix, whatsapp...) become "the installed app of that EXACT name if the catalog has one (Store app, Chrome app, program), else the website". "open google" still opens google.com, never Google Chrome. "open netflx" / "open gmain" (typos of a site) get the same treatment. "open github desktop" is no longer cut down to "github".
  - Order in `open_app`: favorites/profile -> `settings` -> predictor -> website fallback -> Windows built-ins (calc, cmd...) -> old lookup. "open terminal" with no favorite now asks the catalog before saying "no favorite yet".
  - Predictor/catalog improvements found by the benchmark: a swapped-letter typo counts as ONE edit ("paitn" = paint); the maker's name is dropped to make short names ("Microsoft PowerPoint" -> "powerpoint", "power point"); "visual studio code" -> "vs code", "vscode"; the full name beats a derived short name.
  - NEW benchmark `src/fast/bench.mjs` (run: `node src/fast/bench.mjs`) + gate `bench.test.mjs`: a fake PC of ~70 entries, typed requests -> parser -> `open_app` -> what actually started. Tuned set 91 requests: right 83/83, wrong 0, junk opened 0/8. HELD-OUT set (written after tuning, never used to tune) 42 requests: right 34/37 (91.9%), wrong 0, junk 0/5. The test fails the build if tuned top-1 < 97%, held-out < 85%, wrong > 1-2%, or junk is ever opened.
  - Honest limits: the fake PC is not YOUR PC; real accuracy depends on what the scanners find. Misses go to the AI, not to a wrong app. Still hard-coded on purpose: website names (SITES), the "with <media player>" alias table, the Windows built-ins (calc, cmd, paint...) used only as a last fallback, and a short list of generic installer words ("uninstall", "update", "setup"...) that push entries down.
  - Tests: 255 pass / 1 fail (files.test.mjs, old Windows-path fixture failure). ~10 old intent tests that encoded the app list were rewritten to the new behaviour.
  - How to test (Windows): `open spotify`, `open spotfy`, `open whatsap`, `open vsc`, `open powerpoint`, `open google` (must be the website), `open github desktop`, `open netflx`, `open zzzz` (must NOT open anything). Wrong one? `no, I meant ...`, then `show my mistakes`. Use `predict <word>` to see why.

## ROUND 4 SUMMARY
Stages 1-6 done: the three bugs, the catalog, the predictor, model labels (opt-in), learning from corrections, no more app list + a benchmark gate.
