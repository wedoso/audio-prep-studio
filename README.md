# Loudness Matcher

Electron + React + TypeScript desktop app for inspecting WAV/MP3 files, running FFmpeg `loudnorm` analysis, and exporting loudness-matched 24-bit WAV files at 48 kHz or 96 kHz.

## Requirements

- Node.js and npm
- FFmpeg and ffprobe on `PATH`

On macOS:

```bash
brew install ffmpeg
```

## Development

```bash
npm install
npm run dev
```

The Electron renderer dev server runs at `http://localhost:5173/`, and the desktop window opens automatically.

## Verification

```bash
npm run typecheck
npm run build
```

## Current Features

- WAV/MP3 file picker with validation
- Metadata inspection through `ffprobe`
- FFmpeg dependency check at startup
- First-pass `loudnorm` analysis with JSON parsing
- Second-pass loudness normalization
- 48 kHz / 24-bit WAV and 96 kHz / 24-bit WAV export
- Save dialog with overwrite confirmation
- Original and processed audio playback
