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
