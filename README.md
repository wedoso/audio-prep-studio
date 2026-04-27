# Audio Prep Studio

Electron + React + TypeScript desktop app for preparing WAV/MP3 files for delivery. It inspects source metadata, optionally applies light cleanup, analyzes loudness with FFmpeg `loudnorm`, creates an A/B preview, and exports approved 24-bit WAV files at 48 kHz or 96 kHz.

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
- Optional denoise using independently toggleable FFmpeg `afftdn`, high-pass, and low-pass filters
- Optional de-esser with light, medium, and aggressive presets
- Editable loudness target controls for LUFS, true peak, and LRA
- Automatic first-pass `loudnorm` analysis during final export
- Hover tooltips for audio terminology and processing controls
- Temporary 24-bit WAV cleanup preview before loudness matching
- Automatic second-pass loudness matching during final export
- Clear playback tags for original, preview, and exported audio
- Synced A/B playback positions for easier comparison
- A/B switch for quickly toggling playback between original and processed audio
- Seekable local playback through an Electron audio protocol with byte-range support
- Final export format selection after preview approval
- 48 kHz / 24-bit WAV and 96 kHz / 24-bit WAV export after preview approval
- Save dialog with overwrite confirmation for approved exports
- Automatic cleanup of temporary preview WAV files on replacement, export, startup, and app quit

## Workflow

1. Choose a local `.wav` or `.mp3` file.
2. Review detected metadata such as codec, sample rate, channels, bit depth, and duration.
3. Optionally enable denoise and/or de-esser processing. Denoise supports noise floor, high-pass, and low-pass controls.
4. Set final loudness targets.
5. Create a cleanup preview WAV without running loudness matching.
6. Compare original and preview playback from synced positions.
7. Choose the final export preset: `48 kHz / 24-bit WAV` or `96 kHz / 24-bit WAV`.
8. Export the approved file. The app automatically runs loudness analysis, applies loudness matching, writes the final WAV, and cleans temporary previews.
