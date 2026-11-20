# Genisys user test sheet

Tested as a normal user in the dev build (`npm start`), 2026-11-17.

## Round 1

| # | What I asked | What happened | Severity | Status |
|---|---|---|---|---|
| 1 | "create pdf … shopping list for tonight" | The AI wrote raw PDF code (`%PDF-1.4 …`) as the file text. The PDF shows code, not a list. | High | open |
| 2 | "hi", PDF request | Slow: 15 s for "hi", 24 s for the PDF (openrouter nemotron-ultra, 19 s of model wait). | High | open |
| 3 | "that pdf file you created add weekely activity" | Saved a new **.html** file instead of editing the PDF. | High | open |
| 4 | any longer task | "switching to another free model…" shown to the user 3-5 times. | Low | open |
| 5 | "send that pdf to X on whatsapp" | Rewrote the html file again (repeated the previous step). | Med | open |
| 6 | same | Never used `chat_send`. Still looping after 2+ min, opened File Explorer, said "%USERPROFILE% getting duplicated". | High | open |
| 7 | "what time is it in new york" | Wrong: said 12:55 PM in NY and 10:55 PM local, but the PC clock was 21:05 (NY ≈ 2:05 PM). | High | open |
| 8 | "play some chill music on spotify" | Only opened Spotify (as the Chrome PWA, "50% sure"). No music played. | High | open |
| 9 | "remind me in 2 minutes to call mom" | "I can't set a background timer". A basic assistant job is missing. | High | open |
| 10 | same | The same sentence is printed twice (as the reply and again as the question). | Low | open |

Worked: "hi" reply text, the dots fade after the first message, "turn the volume down to 30" (4 s).

## Voice, Stage 1 (2026-11-18)

Dev build with a fake mic that plays a WAV (`test/audio/*.wav`, made with Windows TTS), driven over CDP by `tools/voice-e2e.mjs`.

| # | What I said | What happened | Enter → first spoken word | Status |
|---|---|---|---|---|
| 1 | "Um, set a timer for five minutes called tea" (main window, mic button) | Timer card, spoken "5 minutes timer, starting now…". Whisper heard the TTS "tea" as "T", so the label was "t". | 3.7 s (STT 1.9 s) | ok, label is a fake-voice artefact |
| 2 | "What's the weather in Kigali tomorrow?" (main) | Weather card, spoken "…16 to 23 degrees, 70% chance of rain". | 5.2 to 11 s (weather fetch) | ok |
| 3 | same, Alt+Space runner | 100 px listening pill, Enter → grows to the full bar, card shown and spoken. | 5.2 s | ok |
| 4 | "Make a folder on my desktop called voice test" (AI path) | Folder made on the OneDrive Desktop, AI reply spoken. | 7.8 s | ok |
| 5 | Esc while it speaks | Speech stops in under 300 ms. | | ok |
| 6 | Type "h" while the pill listens | Mic off, the bar grows, the input holds "h". | | ok |
| 7 | Mic blocked (getUserMedia refused) | "Microphone is blocked…" and Windows mic settings open. | | ok |
| 8 | No key / offline | Not tested in the real app (needs keys removed or the network cut). | | open |
| 9 | Real microphone, how the pill feels, voice quality | Not tested by automation. Only the classic Windows voices (George, Hazel, Susan) exist in Electron. | | open |
