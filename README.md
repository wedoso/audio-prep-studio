# Audio Prep Studio

Electron + React + TypeScript desktop app for preparing WAV/MP3 files for delivery. It inspects source metadata, applies previewable processing modules, supports A/B comparison, and exports approved 24-bit WAV files at 48 kHz or 96 kHz.

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
- Optional loudness matching module with editable LUFS, true peak, and LRA targets
- Two-pass FFmpeg `loudnorm` analysis and matching during preview creation
- Hover tooltips for audio terminology and processing controls
- Temporary 24-bit WAV processing preview before final export
- Clear playback tags for original, preview, and exported audio
- Synced A/B playback positions for easier comparison
- A/B switch for quickly toggling playback between original and processed audio
- Seekable local playback through an Electron audio protocol with byte-range support
- Final export format selection after preview approval
- 48 kHz / 24-bit WAV and 96 kHz / 24-bit WAV export from the approved preview
- Save dialog with overwrite confirmation for approved exports
- Automatic cleanup of temporary preview WAV files on replacement, export, startup, and app quit

## Workflow

1. Choose a local `.wav` or `.mp3` file.
2. Review detected metadata such as codec, sample rate, channels, bit depth, and duration.
3. Enable only the processing modules you want to hear: denoise, de-esser, and/or loudness matching.
4. If processing is enabled, tune the settings, create a preview WAV, and compare it against the original from synced positions.
5. If no processing is enabled, skip preview and export directly from the input file.
6. Choose the final export preset: `48 kHz / 24-bit WAV` or `96 kHz / 24-bit WAV`.
7. Export the approved preview, or export the input directly when processing is bypassed. The app converts the source to the selected delivery format and cleans temporary preview files when they exist.
