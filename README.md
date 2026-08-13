# Meeting Summary

Record a meeting from Obsidian, transcribe it with speaker diarisation into a timestamped note, and summarise it with Claude.

## What it does

1. **Record** — capture the meeting from your microphone. A status bar timer shows elapsed time while recording.
2. **Transcribe** — the audio is sent to your configured speech-to-text provider, which returns a timestamped transcript. Claude then attributes the turns to speakers, when enabled.
3. **Write** — a new note is created at `Meetings/Meeting YYYY-MM-DD HH-MM-SS.md` with frontmatter (duration, provider, speakers, language), an optional link to the saved audio, and a `## Transcript` section.
4. **Summarise** — Claude writes a `## Summary` section above the transcript. Runs automatically after transcription, or on demand for any note.

## Commands

| Command | Notes |
| --- | --- |
| Start or stop meeting recording | Also bound to the microphone ribbon icon |
| Start meeting recording | Only available when idle |
| Stop recording and transcribe | Only available while recording |
| Discard current recording | Throws away the audio without transcribing |
| Summarise meeting transcript in this note | Works on any note; re-running replaces the existing summary |

## Installing

This repository holds the source. Obsidian runs `main.js`, which is gitignored and built locally, so cloning on its own leaves the plugin listed in Obsidian but unable to activate. Clone it into your vault and build it:

```bash
git clone git@github.com:ZiningZhu/meeting-summary.git <Vault>/.obsidian/plugins/meeting-summary
cd <Vault>/.obsidian/plugins/meeting-summary
npm install
npm run build
```

The folder name has to be `meeting-summary`, matching the `id` in `manifest.json`.

Then reload Obsidian (`Cmd+R`) and enable Meeting Summary under **Settings → Community plugins**. The plugin list is read at startup, so a freshly built `main.js` stays invisible until you reload. Re-run `npm run build` after every `git pull`.

To work on the plugin itself, `npm run dev` rebuilds on save and `npm run lint` checks style.

## Setup

Open **Settings → Community plugins → Meeting Summary**.

### Recording

**Microphone** picks the input for your own voice. Device names only appear once macOS has granted microphone access, so the list is unnamed until after your first recording.

**Meeting audio** is optional and captures the other end of a call, mixed with your microphone into a single recording. It needs a loopback input device, because macOS gives applications no way to tap system audio directly — Electron can only do it with an entitlement Obsidian does not declare. On macOS:

1. Install [BlackHole 2ch](https://existential.audio/blackhole/) (`brew install --cask blackhole-2ch`) and reboot.
2. In **Audio MIDI Setup**, create a **Multi-Output Device** containing your headphones and BlackHole 2ch. List the headphones first so the real hardware drives the clock.
3. Set that Multi-Output Device as the output in Zoom or Teams. You keep hearing the call, and a copy is routed into BlackHole.
4. Select **BlackHole 2ch** as **Meeting audio** here.

Leave it off for in-person meetings, where there is nothing to capture and a silent second source only makes the recording quieter. Chromium's echo cancellation, noise suppression, and auto gain are disabled on the loopback input — it is a clean digital copy, and that processing would only damage it.

### Transcription

Claude has no speech-to-text endpoint, so transcription uses a dedicated provider:

- **DeepInfra** (default) — [Qwen3-ASR-1.7B](https://deepinfra.com/Qwen/Qwen3-ASR-1.7B) on DeepInfra's inference API, at roughly $0.00045 per audio minute. Needs a DeepInfra API key. Set **DeepInfra model** to any other speech-to-text model on the platform (given as `owner/name`) as long as it returns Whisper-style `segments`.
- **Whisper-compatible** — any endpoint exposing `POST /audio/transcriptions` (OpenAI, or a self-hosted server if you would rather audio did not leave your machine).

Neither provider returns speaker labels. With **Attribute speakers with Claude** enabled, Claude infers turns from the transcript after transcription. That is a best-effort guess: it reads the wording and flow, not the voices, so it is noticeably weaker than acoustic diarisation and will make mistakes on fast exchanges. Turn it off and the whole transcript is attributed to `Speaker 1`.

**Split long recordings** controls how much audio goes in each request, in minutes (10 by default, 0 to send the whole meeting at once). A two-hour meeting is captured as a dozen pieces, transcribed one at a time, and stitched back into a single transcript with the timestamps corrected. Each piece is retried once on failure; anything that still fails becomes a marked gap in the note rather than losing the meeting. The recording itself is still saved as one audio file.

Set **Speaker names** to a comma-separated list to replace `Speaker 1`, `Speaker 2`, … with real names, in order of first speaking turn.

### Summarisation

Needs an Anthropic API key. The model defaults to `claude-opus-5`; **Effort** trades cost against thoroughness. **Summary instructions** is the prompt sent ahead of the transcript — edit it to change the sections produced.

## Privacy

This plugin makes network requests you should be aware of:

- Recorded audio goes to the transcription provider you configure.
- Transcript text goes to Anthropic for summarisation, and again for speaker attribution when that option is enabled.
- API keys are stored in the plugin's `data.json` inside your vault, in plain text.

Nothing is sent anywhere until you start a recording or run a summary. **Do not record a meeting without the consent of everyone in it** — that is your responsibility, and in many jurisdictions a legal requirement.

## Limitations

- Capturing the far end of a call needs a loopback device (see **Recording** above). There is no way around this from inside a plugin: system audio capture requires an `NSAudioCaptureUsageDescription` entitlement in the signed app bundle, and `desktopCapturer` is main-process-only.
- The microphone and the loopback are separate hardware clocks, so over a very long meeting they can drift apart. If you notice the two sides sliding out of sync, build an **Aggregate Device** in Audio MIDI Setup with drift correction instead of using two devices.
- Mobile support depends on the platform granting microphone access to Obsidian's webview; the plugin reports a clear error where it is unavailable.
- Transcription is not real-time. Nothing is sent until you stop recording, and the pieces are transcribed sequentially, so a long meeting takes a few minutes to come back. DeepInfra exposes no streaming ASR endpoint, and Qwen3-ASR's own streaming mode returns no timestamps.
- Splitting cuts on a clock, not on silence, so a word can be clipped at a boundary roughly every N minutes. Raise the split interval to make that rarer.

## Layout

```
src/
  main.ts                  plugin lifecycle
  settings.ts              settings interface, defaults, settings tab
  types.ts                 shared transcript shapes
  audio/recorder.ts        MediaRecorder wrapper, segmented capture
  transcription/           provider dispatch, DeepInfra, Whisper-compatible
  llm/                     Anthropic client, summarisation, speaker attribution
  notes/                   note creation and markdown section editing
  commands/                command registration, recording pipeline, summarise
  utils/                   formatting, multipart encoding
```
