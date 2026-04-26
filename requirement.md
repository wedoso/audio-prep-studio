# Audio Loudness Matching & Upsampling App Requirements

## 1. Project Goal

Build a desktop/local web app that allows a user to import a WAV or MP3 audio file, inspect its audio properties, analyze its loudness with FFmpeg `loudnorm`, and export a loudness-matched 24-bit WAV file at either 48 kHz or 96 kHz.

The app should provide a simple interface to:

- Select an input `.wav` or `.mp3` file.
- Display the input file's audio metadata, including sample rate and bit depth when available.
- Run loudness analysis using FFmpeg.
- Automatically read the JSON result from FFmpeg `loudnorm` analysis.
- Apply two-pass loudness normalization.
- Export the processed file as `48kHz / 24-bit WAV` or `96kHz / 24-bit WAV`.
- Play the original song and processed song inside the app.
- Save the processed file to the local disk.

---

## 2. Target User Workflow

### Basic Flow

1. User opens the app.
2. User selects an input audio file:
   - Supported input: `.wav`, `.mp3`
3. App reads and displays audio metadata:
   - File name
   - Duration
   - Codec
   - Sample rate
   - Channels
   - Bit depth / bits per sample, if available
   - File size
4. User selects output format option:
   - `48 kHz / 24-bit WAV`
   - `96 kHz / 24-bit WAV`
5. User clicks **Analyze Loudness**.
6. App runs FFmpeg `loudnorm` first pass and parses JSON output.
7. App displays measured loudness values:
   - `input_i`
   - `input_tp`
   - `input_lra`
   - `input_thresh`
   - `target_offset`
8. User clicks **Process / Export**.
9. App runs second-pass FFmpeg loudness matching using the measured values.
10. App creates processed WAV file.
11. User can play:
   - Original audio
   - Processed audio
12. User can save/export the processed file to a selected local path.

---

## 3. Functional Requirements

### 3.1 File Input

The app must allow the user to select a local audio file.

Supported formats:

- WAV
- MP3

Validation:

- Reject unsupported file formats.
- Show a clear error if the file cannot be read.
- Show a clear error if FFmpeg cannot decode the file.

---

### 3.2 Audio Metadata Detection

The app must use `ffprobe` to inspect the input file.

Required metadata:

- File path
- File name
- Duration
- Codec name
- Codec type
- Sample rate
- Channel count
- Channel layout, if available
- Bit rate, if available
- Bits per sample / bit depth, if available
- File size

Example command:

```bash
ffprobe -v error \
  -show_entries format=duration,size,bit_rate \
  -show_entries stream=codec_name,codec_type,sample_rate,channels,channel_layout,bits_per_sample,bits_per_raw_sample,bit_rate \
  -of json \
  input.wav
```

Important notes:

- For MP3 files, bit depth may not be available or meaningful. The app should display `N/A` instead of failing.
- For WAV files, prefer `bits_per_sample`; fall back to `bits_per_raw_sample` if needed.

---

### 3.3 Loudness Analysis

The app must run the FFmpeg `loudnorm` first pass.

Default target values:

- Integrated loudness: `-14 LUFS`
- True peak: `-1 dBTP`
- LRA: `11`

Command template:

```bash
ffmpeg -i input.wav \
  -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json \
  -f null -
```

The app must parse the JSON block printed by FFmpeg.

Required parsed fields:

- `input_i`
- `input_tp`
- `input_lra`
- `input_thresh`
- `target_offset`

Parsing requirement:

- FFmpeg may print logs before and after the JSON block.
- The parser must extract the JSON object from stderr reliably.
- The app should validate that all required fields exist before allowing processing.

---

### 3.4 Loudness Matching / Processing

The app must run second-pass loudness normalization using the values from the analysis step.

Command template for 48 kHz output:

```bash
ffmpeg -i input.wav \
  -af loudnorm=I=-14:TP=-1:LRA=11:\
measured_I=<input_i>:\
measured_TP=<input_tp>:\
measured_LRA=<input_lra>:\
measured_thresh=<input_thresh>:\
offset=<target_offset>:\
linear=true \
  -ar 48000 -c:a pcm_s24le \
  output_matched_48k24.wav
```

Command template for 96 kHz output:

```bash
ffmpeg -i input.wav \
  -af loudnorm=I=-14:TP=-1:LRA=11:\
measured_I=<input_i>:\
measured_TP=<input_tp>:\
measured_LRA=<input_lra>:\
measured_thresh=<input_thresh>:\
offset=<target_offset>:\
linear=true \
  -ar 96000 -c:a pcm_s24le \
  output_matched_96k24.wav
```

Output requirements:

- Output must always be WAV.
- Output codec must be `pcm_s24le`.
- Output sample rate must be either `48000` or `96000`.
- Output file should preserve original channel count unless there is a strong reason not to.
- Output file name should default to:
  - `<original_name>_matched_48k24.wav`
  - `<original_name>_matched_96k24.wav`

---

### 3.5 Audio Playback

The app must provide playback controls for both original and processed audio.

Minimum playback controls:

- Play / pause original
- Play / pause processed
- Current time / duration display
- Seek bar

Recommended behavior:

- Do not allow both original and processed audio to play at the same time.
- When one starts playing, pause the other.

---

### 3.6 Save / Export

The app must allow the user to choose where to save the processed output file.

Options:

- Save to default output folder.
- Save As... with a file picker.

The app should not overwrite existing files without confirmation.

---

## 4. User Interface Requirements

### Main Screen Sections

#### A. File Input Panel

- Button: **Choose Audio File**
- Display selected file path
- Display file metadata table

#### B. Target Output Settings

- Radio buttons or dropdown:
  - `48 kHz / 24-bit WAV`
  - `96 kHz / 24-bit WAV`
- Optional advanced settings:
  - Target LUFS, default `-14`
  - True Peak, default `-1`
  - LRA, default `11`

#### C. Loudness Analysis Panel

- Button: **Analyze Loudness**
- Loading/progress indicator
- Display parsed analysis results:
  - Input Integrated LUFS
  - Input True Peak
  - Input LRA
  - Input Threshold
  - Target Offset

#### D. Processing Panel

- Button: **Process / Export WAV**
- Progress indicator
- Display output file path
- Display processing success/failure message

#### E. Playback Panel

- Original audio player
- Processed audio player
- Clear label for each player

---

## 5. Error Handling Requirements

The app must show user-friendly errors for:

- FFmpeg is not installed.
- ffprobe is not installed.
- Unsupported input file type.
- Input file cannot be decoded.
- Loudness analysis fails.
- JSON output cannot be parsed.
- Required loudnorm fields are missing.
- Processing command fails.
- Output path is not writable.
- User cancels file save dialog.

Error messages should include:

- Short user-facing explanation.
- Optional technical details expandable for debugging.

---

## 6. FFmpeg Dependency Requirements

The app requires local FFmpeg and ffprobe.

The app should check availability at startup:

```bash
ffmpeg -version
ffprobe -version
```

If FFmpeg is missing, show installation guidance.

Recommended installation guidance:

### macOS

```bash
brew install ffmpeg
```

### Windows

Tell the user to install FFmpeg and add it to PATH.

---

## 7. Suggested Technical Implementation

The AI Agent may choose one of the following approaches.

### Option A: Electron App

Recommended if a true desktop app is desired.

Possible stack:

- Electron
- React
- TypeScript
- Node.js child_process for FFmpeg execution

Pros:

- Good local file access.
- Easy to package as desktop app.
- Good audio playback support.

### Option B: Python Desktop App

Possible stack:

- Python
- PySide6 or PyQt
- subprocess for FFmpeg

Pros:

- Simple FFmpeg integration.
- Easier backend logic.

### Option C: Local Web App

Possible stack:

- FastAPI backend
- React frontend
- Local file upload
- Python subprocess for FFmpeg

Pros:

- Easier to develop quickly.
- Good separation between UI and processing logic.

Recommended default: **Electron + React + TypeScript**, because the app needs local file picking, local save, and integrated playback.

---

## 8. Internal Data Model

### AudioMetadata

```ts
type AudioMetadata = {
  filePath: string;
  fileName: string;
  durationSeconds: number | null;
  codecName: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  bitRate: number | null;
  bitsPerSample: number | null;
  fileSizeBytes: number | null;
};
```

### LoudnessAnalysisResult

```ts
type LoudnessAnalysisResult = {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
};
```

### ProcessingSettings

```ts
type ProcessingSettings = {
  targetLUFS: number;      // default -14
  truePeak: number;        // default -1
  lra: number;             // default 11
  outputSampleRate: 48000 | 96000;
  outputBitDepth: 24;
  outputCodec: "pcm_s24le";
};
```

---

## 9. Processing Logic

### Step 1: Validate Input

- Confirm file exists.
- Confirm extension is `.wav` or `.mp3`.
- Confirm ffprobe can inspect file.

### Step 2: Extract Metadata

Run ffprobe and map JSON output into `AudioMetadata`.

### Step 3: Analyze Loudness

Run first-pass FFmpeg loudnorm.

Read stderr.

Extract JSON object.

Validate fields.

### Step 4: Process Output

Build second-pass FFmpeg command using parsed values.

Run command.

Track progress if possible.

### Step 5: Verify Output

After output is generated, run ffprobe on the output file.

Confirm:

- Codec is `pcm_s24le`.
- Sample rate is selected target sample rate.
- Output file exists and size is greater than 0.

Optional:

- Run loudnorm summary again to verify final integrated loudness.

---

## 10. Acceptance Criteria

The app is complete when:

1. User can select a WAV file and see metadata.
2. User can select an MP3 file and see metadata.
3. App correctly displays sample rate.
4. App correctly displays bit depth when available.
5. App can run loudness analysis and parse FFmpeg JSON output.
6. App can process the file into `48 kHz / 24-bit WAV`.
7. App can process the file into `96 kHz / 24-bit WAV`.
8. Output file uses `pcm_s24le`.
9. Output file is playable.
10. User can play the original file.
11. User can play the processed file.
12. User can save the processed file to local disk.
13. App shows clear errors when FFmpeg is missing.
14. App shows clear errors when unsupported files are selected.
15. App does not overwrite existing files without confirmation.

---

## 11. Non-Goals for Initial Version

The first version does not need to support:

- Batch processing.
- Album-level reference matching.
- AI mastering.
- EQ matching.
- Compression or limiting controls.
- De-essing.
- Noise reduction.
- Spectrogram display.
- Cloud upload.
- DistroKid or streaming platform API integration.

---

## 12. Future Enhancements

Possible future features:

- Batch process an entire album folder.
- Analyze multiple Mixea-mastered reference tracks and match to album average LUFS.
- Add final loudness verification report.
- Compare waveform before and after.
- Add A/B playback with loudness-matched preview.
- Add output presets:
  - Streaming Master: `48k / 24-bit / -14 LUFS`
  - Hi-Res Format: `96k / 24-bit / -14 LUFS`
  - Louder Pop Master: `48k / 24-bit / -13 LUFS`
- Add drag-and-drop support.
- Package app for macOS and Windows.

---

## 13. Example Commands

### Analyze

```bash
ffmpeg -i input.wav \
  -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json \
  -f null -
```

### Process to 48 kHz / 24-bit WAV

```bash
ffmpeg -i input.wav \
  -af loudnorm=I=-14:TP=-1:LRA=11:\
measured_I=-13.80:\
measured_TP=0.04:\
measured_LRA=8.60:\
measured_thresh=-24.27:\
offset=-1.52:\
linear=true \
  -ar 48000 -c:a pcm_s24le \
  output_matched_48k24.wav
```

### Process to 96 kHz / 24-bit WAV

```bash
ffmpeg -i input.wav \
  -af loudnorm=I=-14:TP=-1:LRA=11:\
measured_I=-15.10:\
measured_TP=-1.85:\
measured_LRA=7.20:\
measured_thresh=-26.90:\
offset=1.10:\
linear=true \
  -ar 96000 -c:a pcm_s24le \
  output_matched_96k24.wav
```
