import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AudioWaveform,
  CheckCircle2,
  Circle,
  FileAudio,
  FolderOpen,
  Info,
  Save,
  SlidersHorizontal
} from 'lucide-react';
import type {
  AudioMetadata,
  DependencyStatus,
  LoudnessAnalysisResult,
  ProcessingSettings,
  ProcessResult
} from '../../main/types';

type SelectedAudio = {
  metadata: AudioMetadata;
  fileUrl: string;
};

type BusyState = 'idle' | 'loading-file' | 'analyzing' | 'processing' | 'exporting';

const DEFAULT_SETTINGS: ProcessingSettings = {
  targetLUFS: -14,
  truePeak: -1,
  lra: 7,
  loudnessEnabled: false,
  outputSampleRate: 48000,
  denoiseEnabled: false,
  denoiseFftEnabled: true,
  denoiseNoiseFloor: -25,
  denoiseHighpassEnabled: true,
  denoiseHighpassHz: 80,
  denoiseLowpassEnabled: true,
  denoiseLowpassHz: 14000,
  deEsserEnabled: false,
  deEsserPreset: 'light'
};

const AFFTDN_NOISE_FLOOR_MIN = -80;
const AFFTDN_NOISE_FLOOR_MAX = -20;

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatBitRate(value: number | null): string {
  if (value === null) return 'N/A';
  return `${Math.round(value / 1000)} kbps`;
}

function Help({ text }: { text: string }) {
  return (
    <span className="tooltip" tabIndex={0} aria-label={text}>
      <Info size={13} />
      <span className="tooltip-content">{text}</span>
    </span>
  );
}

function TermLabel({ children, help }: { children: string; help: string }) {
  return (
    <span className="term-label">
      {children}
      <Help text={help} />
    </span>
  );
}

function Field({ label, value, help }: { label: string; value: string | number | null; help?: string }) {
  return (
    <div className="field">
      <dt>{help ? <TermLabel help={help}>{label}</TermLabel> : label}</dt>
      <dd>{value ?? 'N/A'}</dd>
    </div>
  );
}

function ErrorBox({ error }: { error: { message: string; details?: string } | null }) {
  if (!error) return null;

  return (
    <div className="error-box">
      <strong>{error.message}</strong>
      {error.details ? <details>{error.details}</details> : null}
    </div>
  );
}

function StepPill({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className={`step-pill ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
      {done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
      <span>{label}</span>
    </div>
  );
}

function AudioPlayer({
  label,
  tag,
  detail,
  src,
  audioRef,
  onLoadedMetadata
}: {
  label: string;
  tag: string;
  detail: string;
  src: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onLoadedMetadata: (audio: HTMLAudioElement) => void;
}) {
  return (
    <div className="player">
      <div className="player-header">
        <div>
          <div className="player-label">{label}</div>
          <div className="player-detail">{detail}</div>
        </div>
        <span className={src ? 'playback-tag ready' : 'playback-tag'}>{tag}</span>
      </div>
      <audio
        ref={audioRef}
        src={src ?? undefined}
        controls
        onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget)}
      />
    </div>
  );
}

export function App() {
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const [selected, setSelected] = useState<SelectedAudio | null>(null);
  const [settings, setSettings] = useState<ProcessingSettings>(DEFAULT_SETTINGS);
  const [analysis, setAnalysis] = useState<LoudnessAnalysisResult | null>(null);
  const [processed, setProcessed] = useState<ProcessResult | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [activeCompare, setActiveCompare] = useState<'original' | 'processed'>('original');
  const [noiseFloorInput, setNoiseFloorInput] = useState(String(DEFAULT_SETTINGS.denoiseNoiseFloor));
  const [busy, setBusy] = useState<BusyState>('idle');
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const playbackAudio = useRef<HTMLAudioElement | null>(null);
  const processedRef = useRef<ProcessResult | null>(null);
  const pendingPlaybackRestore = useRef<{ time: number; shouldPlay: boolean } | null>(null);

  useEffect(() => {
    window.audioApp
      .checkDependencies()
      .then(setDeps)
      .catch((caught: Error) => setError({ message: 'Could not check FFmpeg dependencies.', details: caught.message }));
  }, []);

  useEffect(() => {
    processedRef.current = processed;
  }, [processed]);

  useEffect(() => {
    setNoiseFloorInput(String(settings.denoiseNoiseFloor));
  }, [settings.denoiseNoiseFloor]);

  useEffect(() => {
    return () => {
      const current = processedRef.current;
      if (current?.isPreview) {
        void window.audioApp.discardPreview(current.outputPath);
      }
    };
  }, []);

  const dependenciesReady = Boolean(deps?.ffmpeg && deps?.ffprobe);
  const noiseFloorValue = Number(noiseFloorInput);
  const noiseFloorInvalid =
    settings.denoiseEnabled &&
    settings.denoiseFftEnabled &&
    (!/^-?\d+$/.test(noiseFloorInput) ||
      noiseFloorValue < AFFTDN_NOISE_FLOOR_MIN ||
      noiseFloorValue > AFFTDN_NOISE_FLOOR_MAX);
  const hasProcessingEnabled = settings.denoiseEnabled || settings.deEsserEnabled || settings.loudnessEnabled;
  const hasApprovedSource = !hasProcessingEnabled || Boolean(processed?.isPreview);
  const canProcess = dependenciesReady && selected && hasProcessingEnabled && busy === 'idle' && !noiseFloorInvalid;
  const canExport = dependenciesReady && selected && hasApprovedSource && busy === 'idle' && !noiseFloorInvalid;
  const busyLabel =
    busy === 'loading-file'
      ? 'Loading file'
      : busy === 'analyzing'
        ? 'Analyzing'
        : busy === 'processing'
          ? 'Processing preview'
          : busy === 'exporting'
            ? hasProcessingEnabled
              ? 'Exporting approved preview'
              : 'Exporting input file'
            : 'Ready';
  const processedPlaybackTag = exportedPath ? 'Exported WAV' : processed?.isPreview ? 'Preview result' : 'No result';
  const processedPlaybackDetail = exportedPath
    ? `${settings.outputSampleRate / 1000} kHz / 24-bit export`
    : processed?.isPreview
      ? 'Temporary processed preview'
      : 'Create a preview to compare';
  const playbackSrc = activeCompare === 'processed' && processed ? processed.outputUrl : selected?.fileUrl ?? null;
  const playbackLabel = activeCompare === 'processed' ? 'Processed' : 'Original';
  const playbackTag =
    activeCompare === 'processed' ? processedPlaybackTag : selected ? 'Input file' : 'No input';
  const playbackDetail =
    activeCompare === 'processed'
      ? processedPlaybackDetail
      : selected?.metadata.fileName ?? 'Choose an audio file';

  async function discardCurrentPreview() {
    if (!processed?.isPreview) return;

    playbackAudio.current?.pause();
    if (activeCompare === 'processed') {
      setActiveCompare('original');
    }

    try {
      await window.audioApp.discardPreview(processed.outputPath);
    } catch (caught) {
      console.warn('Could not discard preview file.', caught);
    }
  }

  async function chooseFile() {
    setBusy('loading-file');
    setError(null);

    try {
      const result = await window.audioApp.chooseAudioFile();
      if (result) {
        await discardCurrentPreview();
        setSelected(result);
        setActiveCompare('original');
        setAnalysis(null);
        setProcessed(null);
        setExportedPath(null);
      }
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'Could not load the selected file.',
        details: caught instanceof Error ? caught.stack : String(caught)
      });
    } finally {
      setBusy('idle');
    }
  }

  async function process() {
    if (!selected) return;

    setBusy('processing');
    setError(null);
    await discardCurrentPreview();
    setProcessed(null);
    setExportedPath(null);

    try {
      const result = await window.audioApp.processAudio(selected.metadata.filePath, settings);
      setProcessed(result);
      setAnalysis(result.analysis ?? null);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'Processing failed.',
        details: caught instanceof Error ? caught.stack : String(caught)
      });
    } finally {
      setBusy('idle');
    }
  }

  async function exportProcessed() {
    if (!selected || !hasApprovedSource) return;

    setBusy('exporting');
    setError(null);

    try {
      const sourcePath = processed?.isPreview ? processed.outputPath : selected.metadata.filePath;
      const result = await window.audioApp.exportAudio(
        sourcePath,
        selected.metadata.filePath,
        settings,
        Boolean(processed?.isPreview)
      );
      setExportedPath(result.outputPath);
      setProcessed(result);
      setActiveCompare('processed');
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'Export failed.',
        details: caught instanceof Error ? caught.stack : String(caught)
      });
    } finally {
      setBusy('idle');
    }
  }

  function updateNumberSetting(key: 'targetLUFS' | 'truePeak' | 'lra', event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    void discardCurrentPreview();
    setSettings((current) => ({ ...current, [key]: value }));
    setAnalysis(null);
    setProcessed(null);
    setExportedPath(null);
  }

  function updateSampleRate(outputSampleRate: 48000 | 96000) {
    setSettings((current) => ({ ...current, outputSampleRate }));
    setExportedPath(null);
  }

  function updateProcessingSetting(
    patch: Partial<
      Pick<
        ProcessingSettings,
        | 'denoiseEnabled'
        | 'denoiseFftEnabled'
        | 'denoiseNoiseFloor'
        | 'denoiseHighpassEnabled'
        | 'denoiseHighpassHz'
        | 'denoiseLowpassEnabled'
        | 'denoiseLowpassHz'
        | 'deEsserEnabled'
        | 'deEsserPreset'
        | 'loudnessEnabled'
      >
    >
  ) {
    void discardCurrentPreview();
    setSettings((current) => ({ ...current, ...patch }));
    setAnalysis(null);
    setProcessed(null);
    setExportedPath(null);
  }

  function updateNoiseFloorInput(value: string) {
    setNoiseFloorInput(value);

    const nextValue = Number(value);
    if (/^-?\d+$/.test(value) && nextValue >= AFFTDN_NOISE_FLOOR_MIN && nextValue <= AFFTDN_NOISE_FLOOR_MAX) {
      updateProcessingSetting({ denoiseNoiseFloor: nextValue });
    }
  }

  function commitNoiseFloorInput() {
    const nextValue = Number(noiseFloorInput);
    if (
      !/^-?\d+$/.test(noiseFloorInput) ||
      nextValue < AFFTDN_NOISE_FLOOR_MIN ||
      nextValue > AFFTDN_NOISE_FLOOR_MAX
    ) {
      setNoiseFloorInput(String(settings.denoiseNoiseFloor));
    }
  }

  function restorePlaybackPosition(audio: HTMLAudioElement) {
    const pending = pendingPlaybackRestore.current;
    if (!pending) return;

    const duration = Number.isFinite(audio.duration) ? audio.duration : pending.time;
    const nextTime = Math.max(0, Math.min(pending.time, duration));

    try {
      audio.currentTime = nextTime;
    } catch (caught) {
      console.warn('Could not restore playback position.', caught);
    }

    if (pending.shouldPlay) {
      void audio.play().catch((caught) => console.warn('Could not resume playback after switching.', caught));
    }
    pendingPlaybackRestore.current = null;
  }

  function switchComparison(next: 'original' | 'processed') {
    if (next === activeCompare) return;
    if (next === 'original' && !selected) return;
    if (next === 'processed' && !processed) return;

    const audio = playbackAudio.current;
    if (audio?.src) {
      pendingPlaybackRestore.current = {
        time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        shouldPlay: !audio.paused
      };
    }
    setActiveCompare(next);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Audio Prep Studio</h1>
          <div className="runtime-line">
            <span>{busyLabel}</span>
            <span>{deps?.ffmpegVersion ?? 'FFmpeg status pending'}</span>
          </div>
        </div>
        <div className={dependenciesReady ? 'status ok' : 'status warn'}>
          <Activity size={18} />
          {dependenciesReady ? 'FFmpeg ready' : 'FFmpeg missing'}
        </div>
      </header>

      <section className="workflow-strip">
        <StepPill label="File" done={Boolean(selected)} active={!selected} />
        <StepPill
          label="Processing"
          done={Boolean(selected)}
          active={Boolean(
            selected && !processed && (settings.denoiseEnabled || settings.deEsserEnabled || settings.loudnessEnabled)
          )}
        />
        <StepPill
          label="Preview"
          done={Boolean(processed) || Boolean(selected && !hasProcessingEnabled)}
          active={Boolean(selected && hasProcessingEnabled && !processed)}
        />
        <StepPill
          label="Export"
          done={Boolean(exportedPath)}
          active={Boolean(selected && hasApprovedSource && !exportedPath)}
        />
      </section>

      {!dependenciesReady ? (
        <section className="dependency-panel">
          <h2>Install FFmpeg</h2>
          <p>FFmpeg and ffprobe must be available on PATH before this app can analyze or process audio.</p>
          <code>brew install ffmpeg</code>
        </section>
      ) : null}

      <ErrorBox error={error} />

      <div className="workspace">
        <section className="panel file-panel">
          <div className="panel-heading">
            <div className="heading-title">
              <FileAudio size={20} />
              <h2>Input File</h2>
            </div>
            <span className={selected ? 'panel-badge ready' : 'panel-badge'}>{selected ? 'Loaded' : 'Empty'}</span>
          </div>
          <button className="primary-action" onClick={chooseFile} disabled={busy !== 'idle'}>
            <FolderOpen size={18} />
            Choose Audio File
          </button>
          <div className="path-line compact-path">{selected?.metadata.filePath ?? 'No file selected'}</div>

          <dl className="metadata-grid">
            <Field label="File name" value={selected?.metadata.fileName ?? null} />
            <Field label="Duration" value={selected ? formatDuration(selected.metadata.durationSeconds) : null} />
            <Field label="Codec" value={selected?.metadata.codecName ?? null} help="The encoding format used by the input file, such as PCM WAV or MP3." />
            <Field label="Sample rate" value={selected?.metadata.sampleRate ? `${selected.metadata.sampleRate} Hz` : null} help="How many audio samples exist per second. Higher values can preserve more high-frequency detail but create larger files." />
            <Field label="Channels" value={selected?.metadata.channels ?? null} help="The number of audio channels, for example 1 for mono or 2 for stereo." />
            <Field label="Layout" value={selected?.metadata.channelLayout ?? null} help="The speaker arrangement reported by FFprobe, such as stereo." />
            <Field label="Bit depth" value={selected?.metadata.bitsPerSample ? `${selected.metadata.bitsPerSample}-bit` : null} help="How much resolution each sample has. Higher bit depth gives more headroom for processing." />
            <Field label="Bit rate" value={selected ? formatBitRate(selected.metadata.bitRate) : null} help="Approximate data rate of the audio stream. It affects file size and, for compressed formats, quality." />
            <Field label="File size" value={selected ? formatBytes(selected.metadata.fileSizeBytes) : null} />
          </dl>
        </section>

        <section className="panel processing-panel">
          <div className="panel-heading">
            <div className="heading-title">
              <SlidersHorizontal size={20} />
              <h2>Processing</h2>
            </div>
            <span
              className={
                settings.denoiseEnabled || settings.deEsserEnabled || settings.loudnessEnabled
                  ? 'panel-badge ready'
                  : 'panel-badge'
              }
            >
              {settings.denoiseEnabled || settings.deEsserEnabled || settings.loudnessEnabled ? 'Enabled' : 'Bypassed'}
            </span>
          </div>
          <div className="module-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.denoiseEnabled}
                onChange={(event) => updateProcessingSetting({ denoiseEnabled: event.target.checked })}
              />
              <span>
                <strong>
                  Light denoise
                  <Help text="Applies FFT noise reduction, an 80 Hz high-pass filter, and a 14 kHz low-pass filter by default. It can reduce hiss, rumble, and harsh upper noise, but stronger settings may dull the track." />
                </strong>
                <small>FFT denoise, high-pass, and low-pass cleanup</small>
              </span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.deEsserEnabled}
                onChange={(event) => updateProcessingSetting({ deEsserEnabled: event.target.checked })}
              />
              <span>
                <strong>
                  De-esser
                  <Help text="Reduces sharp sibilance and hiss in the upper frequencies. Stronger settings can make vocals less harsh, but too much can dull the track." />
                </strong>
                <small>Reduces harsh sibilance around 6.2 kHz and 9 kHz</small>
              </span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.loudnessEnabled}
                onChange={(event) => updateProcessingSetting({ loudnessEnabled: event.target.checked })}
              />
              <span>
                <strong>
                  Loudness matching
                  <Help text="Measures perceived loudness and adjusts the preview toward the target LUFS, true peak, and loudness range. This helps compare the finished sound before export." />
                </strong>
                <small>Two-pass FFmpeg loudnorm adjustment</small>
              </span>
            </label>
          </div>
          <div className="settings-group">
            <div className="settings-group-title">Denoise</div>
            <div className="number-row denoise-controls">
            <label>
              <TermLabel help="Noise floor for FFmpeg afftdn. Valid range is -80 to -20 dB. More negative values are lighter; values closer to -20 remove more noise but can create artifacts.">Noise floor</TermLabel>
              <label className="mini-toggle">
                <input
                  type="checkbox"
                  checked={settings.denoiseFftEnabled}
                  disabled={!settings.denoiseEnabled}
                  onChange={(event) => updateProcessingSetting({ denoiseFftEnabled: event.target.checked })}
                />
                FFT denoise
              </label>
              <input
                type="text"
                inputMode="numeric"
                className={noiseFloorInvalid ? 'invalid-input' : ''}
                value={noiseFloorInput}
                disabled={!settings.denoiseEnabled || !settings.denoiseFftEnabled}
                onChange={(event) => updateNoiseFloorInput(event.target.value)}
                onBlur={commitNoiseFloorInput}
              />
              {noiseFloorInvalid ? <small className="field-warning">Use -80 to -20 dB</small> : null}
            </label>
            <label>
              <TermLabel help="Removes low-frequency rumble below this frequency. Raising it cleans more low end but may thin bass or kick.">High-pass Hz</TermLabel>
              <label className="mini-toggle">
                <input
                  type="checkbox"
                  checked={settings.denoiseHighpassEnabled}
                  disabled={!settings.denoiseEnabled}
                  onChange={(event) => updateProcessingSetting({ denoiseHighpassEnabled: event.target.checked })}
                />
                High-pass
              </label>
              <input
                type="number"
                step="5"
                min="20"
                value={settings.denoiseHighpassHz}
                disabled={!settings.denoiseEnabled || !settings.denoiseHighpassEnabled}
                onChange={(event) => updateProcessingSetting({ denoiseHighpassHz: Number(event.target.value) })}
              />
            </label>
            <label>
              <TermLabel help="Removes very high-frequency hiss above this frequency. Lowering it removes more hiss but may reduce brightness and air.">Low-pass Hz</TermLabel>
              <label className="mini-toggle">
                <input
                  type="checkbox"
                  checked={settings.denoiseLowpassEnabled}
                  disabled={!settings.denoiseEnabled}
                  onChange={(event) => updateProcessingSetting({ denoiseLowpassEnabled: event.target.checked })}
                />
                Low-pass
              </label>
              <input
                type="number"
                step="100"
                min="1000"
                value={settings.denoiseLowpassHz}
                disabled={!settings.denoiseEnabled || !settings.denoiseLowpassEnabled}
                onChange={(event) => updateProcessingSetting({ denoiseLowpassHz: Number(event.target.value) })}
              />
            </label>
            </div>
          </div>
          <div className="settings-group">
            <div className="settings-group-title">De-esser</div>
            <div className="preset-row">
            <label>
              <TermLabel help="Controls how much high-frequency reduction is applied by the de-esser. Start with Light and increase only if the preview still sounds harsh.">De-esser preset</TermLabel>
              <select
                value={settings.deEsserPreset}
                disabled={!settings.deEsserEnabled}
                onChange={(event) =>
                  updateProcessingSetting({
                    deEsserPreset: event.target.value as ProcessingSettings['deEsserPreset']
                  })
                }
              >
                <option value="light">Light</option>
                <option value="medium">Medium</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            </div>
          </div>
          <div className="settings-group">
            <div className="settings-group-title">Loudness</div>
            <div className="number-row loudness-controls">
            <label>
              <TermLabel help="Integrated loudness target. More negative values sound quieter; less negative values sound louder. -14 LUFS is a common streaming target.">Target LUFS</TermLabel>
              <input
                type="number"
                step="0.1"
                value={settings.targetLUFS}
                disabled={!settings.loudnessEnabled}
                onChange={(event) => updateNumberSetting('targetLUFS', event)}
              />
            </label>
            <label>
              <TermLabel help="Maximum allowed peak after processing. Keeping this below 0 dB helps avoid clipping during playback or conversion.">True Peak</TermLabel>
              <input
                type="number"
                step="0.1"
                value={settings.truePeak}
                disabled={!settings.loudnessEnabled}
                onChange={(event) => updateNumberSetting('truePeak', event)}
              />
            </label>
            <label>
              <TermLabel help="Loudness range target. Lower values compress perceived dynamics; higher values preserve more contrast between quiet and loud sections.">LRA</TermLabel>
              <input
                type="number"
                step="0.1"
                value={settings.lra}
                disabled={!settings.loudnessEnabled}
                onChange={(event) => updateNumberSetting('lra', event)}
              />
            </label>
            </div>
          </div>
        </section>

        <section className="panel delivery-panel">
          <div className="panel-heading">
            <div className="heading-title">
              <Save size={20} />
              <h2>Preview & Export</h2>
            </div>
            <span className={exportedPath ? 'panel-badge ready' : processed ? 'panel-badge ready' : 'panel-badge'}>
              {exportedPath ? 'Exported' : processed ? 'Preview ready' : 'Pending'}
            </span>
          </div>
          {hasProcessingEnabled ? (
            <>
              <button className="primary-action full-width-action" onClick={process} disabled={!canProcess}>
                <AudioWaveform size={18} />
                {busy === 'processing' ? 'Processing...' : 'Create Preview'}
              </button>
              <div className="path-line compact-path">{processed?.outputPath ?? 'No preview file yet'}</div>
              {processed ? (
                <dl className="metadata-grid compact">
                  <Field label="Output codec" value={processed.metadata.codecName} />
                  <Field label="Preview sample rate" value={processed.metadata.sampleRate ? `${processed.metadata.sampleRate} Hz` : null} help="The temporary preview keeps the processed sound for listening. Final sample rate is selected during export." />
                  <Field label="Preview bit depth" value={processed.metadata.bitsPerSample ? `${processed.metadata.bitsPerSample}-bit` : null} help="The preview is rendered as 24-bit WAV for clean listening before export." />
                  <Field label="Output size" value={formatBytes(processed.metadata.fileSizeBytes)} />
                  <Field label="Loudness" value={analysis ? `${analysis.input_i} LUFS measured` : 'Bypassed'} help="When loudness matching is enabled, this is the first-pass loudness measurement used to create the preview." />
                </dl>
              ) : null}
              <div className="delivery-divider" />
            </>
          ) : null}
          <div className="segmented">
            <button
              className={settings.outputSampleRate === 48000 ? 'selected' : ''}
              onClick={() => updateSampleRate(48000)}
              title="48 kHz is the standard choice for video, streaming workflows, and smaller final WAV files."
            >
              48 kHz / 24-bit WAV
            </button>
            <button
              className={settings.outputSampleRate === 96000 ? 'selected' : ''}
              onClick={() => updateSampleRate(96000)}
              title="96 kHz creates a larger high-resolution WAV. Use it when a hi-res delivery format is required."
            >
              96 kHz / 24-bit WAV
            </button>
          </div>
          <div className="format-note">
            <TermLabel help="The sample rate controls how many samples per second the exported WAV contains. Bit depth stays fixed at 24-bit for delivery headroom.">Preset output</TermLabel>
            <span>{settings.outputSampleRate / 1000} kHz / 24-bit PCM WAV</span>
          </div>
          <div className="format-note">
            <TermLabel help="When processing is enabled, export writes the approved preview. When processing is off, export converts the input file directly.">Export source</TermLabel>
            <span>
              {processed
                ? 'Approved preview'
                : hasProcessingEnabled
                  ? 'Create a preview first'
                  : 'Input file, no processing'}
            </span>
          </div>
          <button className="primary-action full-width-action export-action" onClick={exportProcessed} disabled={!canExport}>
            <Save size={18} />
            {busy === 'exporting' ? 'Exporting...' : `Export ${settings.outputSampleRate / 1000} kHz WAV`}
          </button>
          <div className="path-line compact-path">{exportedPath ?? 'No exported file yet'}</div>
        </section>
      </div>

      <section className="panel playback-panel">
        <div className="panel-heading">
          <div className="heading-title">
            <AudioWaveform size={20} />
            <h2>Playback</h2>
          </div>
          <span className={processed ? 'panel-badge ready' : 'panel-badge'}>{processed ? 'A/B ready' : 'Waiting'}</span>
        </div>
        <div className="ab-switch">
          <button
            className={activeCompare === 'original' ? 'selected' : ''}
            onClick={() => switchComparison('original')}
            disabled={!selected}
          >
            Original
          </button>
          <button
            className={activeCompare === 'processed' ? 'selected' : ''}
            onClick={() => switchComparison('processed')}
            disabled={!processed}
          >
            Processed
          </button>
        </div>
        <div className="players">
          <AudioPlayer
            label={playbackLabel}
            tag={playbackTag}
            detail={playbackDetail}
            src={playbackSrc}
            audioRef={playbackAudio}
            onLoadedMetadata={restorePlaybackPosition}
          />
        </div>
      </section>
    </main>
  );
}
