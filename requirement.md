## 1. Overview

Build a desktop or web-based application that allows users to:

- Upload an audio file (`.wav` or `.mp3`)
- Analyze loudness using FFmpeg (`loudnorm`)
- Apply loudness normalization to match a target LUFS
- Convert output to:
  - **48 kHz / 24-bit WAV**
  - **96 kHz / 24-bit WAV**
- Optionally apply **audio enhancement preprocessing**:
  - Light denoise (high-pass filter)
  - De-esser (high-frequency reduction)
- Preview original and processed audio
- Export processed file to local disk

---

## 2. Core Features

### 2.1 File Input
- Supported formats:
  - `.wav`
  - `.mp3`
- Automatically detect:
  - Sample rate
  - Bit depth
  - Channels

Use:
```bash
ffprobe -v quiet -print_format json -show_streams input.wav
```

---

### 2.2 Loudness Analysis

Run FFmpeg loudness analysis:

```bash
ffmpeg -i input.wav \
-af loudnorm=I=-14:TP=-1:LRA=11:print_format=json \
-f null -
```

Parse JSON output:
- `input_i`
- `input_tp`
- `input_lra`
- `input_thresh`
- `target_offset`

---

### 2.3 Loudness Matching

Use two-pass loudnorm:

```bash
ffmpeg -i input.wav \
-af loudnorm=I={target_LUFS}:TP={true_peak}:LRA={LRA}:\
measured_I={input_i}:\
measured_TP={input_tp}:\
measured_LRA={input_lra}:\
measured_thresh={input_thresh}:\
offset={target_offset}:\
linear=true \
-ar {sample_rate} -c:a pcm_s24le \
output.wav
```

---

## 3. Optional Audio Processing (NEW)

Users can enable preprocessing before loudness normalization.

### 3.1 Processing Pipeline Order

```
Input → (Denoise) → (De-esser) → Loudnorm → Output
```

---

### 3.2 Denoise (Light Noise Reduction)

Purpose:
- Remove low-frequency rumble / electrical noise

FFmpeg reference:

```bash
ffmpeg -i input.wav \
-af "highpass=f=80" \
-c:a pcm_s24le output_denoised.wav
```

UI Option:
- Toggle: Enable Denoise
- Optional control (future):
  - Cutoff frequency (default: 80 Hz)

---

### 3.3 De-esser (Sibilance Reduction)

Purpose:
- Reduce harsh "s", "sh", high-frequency hiss

FFmpeg reference:

```bash
ffmpeg -i input.wav \
-af "equalizer=f=6200:t=q:w=2.2:g=-2,\
equalizer=f=9000:t=q:w=2.5:g=-1" \
-c:a pcm_s24le output_deess.wav
```

UI Option:
- Toggle: Enable De-esser
- Optional presets:
  - Light (default)
  - Medium
  - Aggressive

---

### 3.4 Combined Processing

If both enabled, chain filters:

```bash
-af "highpass=f=80,\
equalizer=f=6200:t=q:w=2.2:g=-2,\
equalizer=f=9000:t=q:w=2.5:g=-1"
```

---

## 4. Output Settings

### 4.1 Format Options
- 48 kHz / 24-bit WAV
- 96 kHz / 24-bit WAV

### 4.2 Loudness Settings (User Editable)
- Target LUFS (default: -14)
- True Peak (default: -1 dB)
- LRA (default: optional / 7 recommended)

---

## 5. UI Requirements

### 5.1 Main Sections

#### File Input
- Upload button
- Show file metadata

#### Output Settings
- Toggle:
  - 48kHz / 24-bit
  - 96kHz / 24-bit

#### Loudness Controls
- LUFS input
- True Peak input
- LRA input

#### Audio Processing (NEW)
- Checkbox:
  - Enable Denoise
  - Enable De-esser

#### Playback
- Play original audio
- Play processed audio

#### Export
- Save to local disk

---

## 6. Processing Flow

1. User uploads file
2. Run `ffprobe` → extract metadata
3. Run loudnorm analysis (pass 1)
4. Build processing chain:
   - Optional filters (denoise / de-ess)
   - Loudnorm (pass 2)
5. Run FFmpeg command
6. Output final WAV file
7. Enable playback + export

---

## 7. Error Handling

- Invalid file format
- FFmpeg execution failure
- Missing loudnorm JSON fields
- Audio clipping risk (warn if TP > 0)

---

## 8. Future Enhancements (Optional)

- Batch processing
- Reference track matching (album-level loudness)
- Spectral denoise (advanced AI)
- Visual waveform + LUFS meter
- Presets (Streaming / Mixea-like / Broadcast)

---

## 9. Key Design Principle

The tool should prioritize clean loudness alignment and minimal audio degradation, while providing optional light enhancement tools (denoise / de-esser) without over-processing.
