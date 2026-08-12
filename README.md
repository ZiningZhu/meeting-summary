# Meeting Summary

Record a meeting from Obsidian, transcribe it with speaker diarisation into a timestamped note, and summarise it with Claude.

## What it does

1. **Record** — capture the meeting from your microphone. A status bar timer shows elapsed time while recording.
2. **Transcribe** — the audio is sent to your configured speech-to-text provider, which returns a speaker-labelled transcript.
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

## Setup

Open **Settings → Community plugins → Meeting Summary**.

### Transcription

Claude has no speech-to-text endpoint, so transcription uses a dedicated provider:

- **Deepgram** (default) — performs acoustic diarisation server-side and returns one utterance per speaker turn. This gives the most reliable speaker labels. Needs a Deepgram API key.
- **Whisper-compatible** — any endpoint exposing `POST /audio/transcriptions` (OpenAI, or a self-hosted server if you would rather audio did not leave your machine). These return no speaker labels; with **Attribute speakers with Claude** enabled, Claude infers turns from the transcript afterwards. That is a best-effort guess and is noticeably weaker than acoustic diarisation.

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

- Recording uses the `MediaRecorder` API and captures **microphone input only**. It does not capture system audio, so remote participants are only recorded if they come through your room's speakers. For calls, route the meeting audio into a virtual input device (BlackHole, Loopback, VB-Cable) and select it as your system microphone.
- Mobile support depends on the platform granting microphone access to Obsidian's webview; the plugin reports a clear error where it is unavailable.
- Very long meetings are transcribed in one request. Provider file-size and duration limits apply.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check and production build
npm run lint
```

To test in a vault, copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/meeting-summary/`, then enable the plugin under **Settings → Community plugins**. For live reloading, develop directly in that folder — the plugin id (`meeting-summary`) should match the folder name.

### Layout

```
src/
  main.ts                  plugin lifecycle
  settings.ts              settings interface, defaults, settings tab
  types.ts                 shared transcript shapes
  audio/recorder.ts        MediaRecorder wrapper
  transcription/           provider dispatch, Deepgram, Whisper-compatible
  llm/                     Anthropic client, summarisation, speaker attribution
  notes/                   note creation and markdown section editing
  commands/                command registration, recording pipeline, summarise
  utils/                   formatting, multipart encoding
```
