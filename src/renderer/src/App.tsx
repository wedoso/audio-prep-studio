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
  outputSampleRate: 48000,
  denoiseEnabled: false,
  deEsserEnabled: false,
  deEsserPreset: 'light'
};

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
  onPlay,
  onSeek,
  onTimeUpdate
}: {
  label: string;
  tag: string;
  detail: string;
  src: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onPlay: (audio: HTMLAudioElement) => void;
  onSeek: (audio: HTMLAudioElement) => void;
  onTimeUpdate: (audio: HTMLAudioElement) => void;
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
        onPlay={(event) => onPlay(event.currentTarget)}
        onSeeked={(event) => onSeek(event.currentTarget)}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget)}
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
  const [busy, setBusy] = useState<BusyState>('idle');
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const originalAudio = useRef<HTMLAudioElement | null>(null);
  const processedAudio = useRef<HTMLAudioElement | null>(null);
  const processedRef = useRef<ProcessResult | null>(null);
  const syncingAudio = useRef(false);

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
    return () => {
      const current = processedRef.current;
      if (current?.isPreview) {
        void window.audioApp.discardPreview(current.outputPath);
      }
    };
  }, []);

  const dependenciesReady = Boolean(deps?.ffmpeg && deps?.ffprobe);
  const canAnalyze = dependenciesReady && selected && busy === 'idle';
  const canProcess = canAnalyze && analysis;
  const canExport = dependenciesReady && selected && processed?.isPreview && busy === 'idle';
  const busyLabel =
    busy === 'loading-file'
      ? 'Loading file'
      : busy === 'analyzing'
        ? 'Analyzing'
        : busy === 'processing'
          ? 'Processing preview'
          : busy === 'exporting'
            ? 'Exporting'
            : 'Ready';
  const processedPlaybackTag = exportedPath ? 'Exported WAV' : processed?.isPreview ? 'Preview result' : 'No result';
  const processedPlaybackDetail = exportedPath
    ? `${settings.outputSampleRate / 1000} kHz / 24-bit export`
    : processed?.isPreview
      ? 'Temporary processed preview'
      : 'Create a preview to compare';

  async function discardCurrentPreview() {
    if (!processed?.isPreview) return;

    processedAudio.current?.pause();

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

  async function analyze() {
    if (!selected) return;

    setBusy('analyzing');
    setError(null);
    await discardCurrentPreview();
    setAnalysis(null);
    setProcessed(null);
    setExportedPath(null);

    try {
      const result = await window.audioApp.analyzeLoudness(selected.metadata.filePath, {
        targetLUFS: settings.targetLUFS,
        truePeak: settings.truePeak,
        lra: settings.lra,
        denoiseEnabled: settings.denoiseEnabled,
        deEsserEnabled: settings.deEsserEnabled,
        deEsserPreset: settings.deEsserPreset
      });
      setAnalysis(result);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'Loudness analysis failed.',
        details: caught instanceof Error ? caught.stack : String(caught)
      });
    } finally {
      setBusy('idle');
    }
  }

  async function process() {
    if (!selected || !analysis) return;

    setBusy('processing');
    setError(null);
    await discardCurrentPreview();
    setProcessed(null);
    setExportedPath(null);

    try {
      const result = await window.audioApp.processAudio(selected.metadata.filePath, settings, analysis);
      setProcessed(result);
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
    if (!selected || !processed) return;

    setBusy('exporting');
    setError(null);

    try {
      const result = await window.audioApp.exportAudio(processed.outputPath, selected.metadata.filePath, settings);
      setExportedPath(result.outputPath);
      setProcessed(result);
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
    patch: Partial<Pick<ProcessingSettings, 'denoiseEnabled' | 'deEsserEnabled' | 'deEsserPreset'>>
  ) {
    void discardCurrentPreview();
    setSettings((current) => ({ ...current, ...patch }));
    setAnalysis(null);
    setProcessed(null);
    setExportedPath(null);
  }

  function syncAudioPosition(source: HTMLAudioElement, target: HTMLAudioElement | null) {
    if (!target || !source.src || !target.src || syncingAudio.current) return;
    if (!Number.isFinite(source.currentTime)) return;

    const targetDuration = Number.isFinite(target.duration) ? target.duration : source.currentTime;
    const nextTime = Math.max(0, Math.min(source.currentTime, targetDuration));

    if (Math.abs(target.currentTime - nextTime) < 0.2) return;

    syncingAudio.current = true;
    try {
      target.currentTime = nextTime;
    } catch (caught) {
      console.warn('Could not sync playback position.', caught);
    }
    window.setTimeout(() => {
      syncingAudio.current = false;
    }, 0);
  }

  function handleOriginalPlay(audio: HTMLAudioElement) {
    syncAudioPosition(audio, processedAudio.current);
    processedAudio.current?.pause();
  }

  function handleProcessedPlay(audio: HTMLAudioElement) {
    syncAudioPosition(audio, originalAudio.current);
    originalAudio.current?.pause();
  }

  function handleOriginalSeek(audio: HTMLAudioElement) {
    syncAudioPosition(audio, processedAudio.current);
  }

  function handleProcessedSeek(audio: HTMLAudioElement) {
    syncAudioPosition(audio, originalAudio.current);
  }

  function handleOriginalTimeUpdate(audio: HTMLAudioElement) {
    if (!audio.paused) {
      syncAudioPosition(audio, processedAudio.current);
    }
  }

  function handleProcessedTimeUpdate(audio: HTMLAudioElement) {
    if (!audio.paused) {
      syncAudioPosition(audio, originalAudio.current);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Loudness Matcher</h1>
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
          label="Add-ons"
          done={Boolean(selected)}
          active={Boolean(selected && !analysis && (settings.denoiseEnabled || settings.deEsserEnabled))}
        />
        <StepPill label="Preview" done={Boolean(processed)} active={Boolean(analysis && !processed)} />
        <StepPill label="Export" done={Boolean(exportedPath)} active={Boolean(processed && !exportedPath)} />
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
          <div className="path-line">{selected?.metadata.filePath ?? 'No file selected'}</div>

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

        <section className="panel">
          <div className="panel-heading">
            <div className="heading-title">
              <SlidersHorizontal size={20} />
              <h2>Loudness Target</h2>
            </div>
            <span className="panel-badge ready">Editable</span>
          </div>
          <div className="number-row">
            <label>
              <TermLabel help="Integrated loudness target. More negative values sound quieter; less negative values sound louder. -14 LUFS is a common streaming target.">Target LUFS</TermLabel>
              <input type="number" step="0.1" value={settings.targetLUFS} onChange={(event) => updateNumberSetting('targetLUFS', event)} />
            </label>
            <label>
              <TermLabel help="Maximum allowed peak after processing. Keeping this below 0 dB helps avoid clipping during playback or conversion.">True Peak</TermLabel>
              <input type="number" step="0.1" value={settings.truePeak} onChange={(event) => updateNumberSetting('truePeak', event)} />
            </label>
            <label>
              <TermLabel help="Loudness range target. Lower values compress perceived dynamics; higher values preserve more contrast between quiet and loud sections.">LRA</TermLabel>
              <input type="number" step="0.1" value={settings.lra} onChange={(event) => updateNumberSetting('lra', event)} />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div className="heading-title">
              <SlidersHorizontal size={20} />
              <h2>Audio Processing</h2>
            </div>
            <span className={settings.denoiseEnabled || settings.deEsserEnabled ? 'panel-badge ready' : 'panel-badge'}>
              {settings.denoiseEnabled || settings.deEsserEnabled ? 'Enabled' : 'Bypassed'}
            </span>
          </div>
          <div className="toggle-stack">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.denoiseEnabled}
                onChange={(event) => updateProcessingSetting({ denoiseEnabled: event.target.checked })}
              />
              <span>
                <strong>
                  Light denoise
                  <Help text="Applies an 80 Hz high-pass filter. It reduces low rumble and electrical hum, but too much low-cut can thin out bass-heavy material." />
                </strong>
                <small>High-pass filter at 80 Hz</small>
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
          </div>
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
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div className="heading-title">
              <AudioWaveform size={20} />
              <h2>Loudness Analysis</h2>
            </div>
            <span className={analysis ? 'panel-badge ready' : 'panel-badge'}>{analysis ? 'Measured' : 'Pending'}</span>
          </div>
          <button className="primary-action" onClick={analyze} disabled={!canAnalyze}>
            <Activity size={18} />
            {busy === 'analyzing' ? 'Analyzing...' : 'Analyze Loudness'}
          </button>
          <dl className="metadata-grid compact">
            <Field label="Input Integrated LUFS" value={analysis?.input_i ?? null} help="The measured average loudness of the analyzed audio after optional add-on processing." />
            <Field label="Input True Peak" value={analysis?.input_tp ?? null} help="The highest estimated playback peak in the analyzed audio. Values above 0 can clip." />
            <Field label="Input LRA" value={analysis?.input_lra ?? null} help="Measured loudness range, showing how much loudness variation exists across the track." />
            <Field label="Input Threshold" value={analysis?.input_thresh ?? null} help="The gating threshold FFmpeg used while measuring loudness." />
            <Field label="Target Offset" value={analysis?.target_offset ?? null} help="The gain offset FFmpeg calculates to hit the target loudness." />
          </dl>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div className="heading-title">
              <Save size={20} />
              <h2>Process Preview</h2>
            </div>
            <span className={exportedPath ? 'panel-badge ready' : processed ? 'panel-badge ready' : 'panel-badge'}>
              {exportedPath ? 'Exported' : processed ? 'Preview ready' : 'Pending'}
            </span>
          </div>
          <button className="primary-action" onClick={process} disabled={!canProcess}>
            <AudioWaveform size={18} />
            {busy === 'processing' ? 'Processing...' : 'Create Preview WAV'}
          </button>
          <div className="path-line">{processed?.outputPath ?? 'No preview file yet'}</div>
          {processed ? (
            <dl className="metadata-grid compact">
              <Field label="Output codec" value={processed.metadata.codecName} />
              <Field label="Preview sample rate" value={processed.metadata.sampleRate ? `${processed.metadata.sampleRate} Hz` : null} help="The temporary preview keeps the processed sound for listening. Final sample rate is selected during export." />
              <Field label="Preview bit depth" value={processed.metadata.bitsPerSample ? `${processed.metadata.bitsPerSample}-bit` : null} help="The preview is rendered as 24-bit WAV for clean listening before export." />
              <Field label="Output size" value={formatBytes(processed.metadata.fileSizeBytes)} />
            </dl>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div className="heading-title">
              <Save size={20} />
              <h2>Export Format</h2>
            </div>
            <span className={exportedPath ? 'panel-badge ready' : processed ? 'panel-badge ready' : 'panel-badge'}>
              {exportedPath ? 'Saved' : processed ? 'Ready' : 'Waiting'}
            </span>
          </div>
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
          <button className="secondary-action" onClick={exportProcessed} disabled={!canExport}>
            <Save size={18} />
            {busy === 'exporting' ? 'Exporting...' : 'Export Approved WAV'}
          </button>
          <div className="path-line">{exportedPath ?? 'No exported file yet'}</div>
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
        <div className="players">
          <AudioPlayer
            label="Original"
            tag={selected ? 'Input file' : 'No input'}
            detail={selected?.metadata.fileName ?? 'Choose an audio file'}
            src={selected?.fileUrl ?? null}
            audioRef={originalAudio}
            onPlay={handleOriginalPlay}
            onSeek={handleOriginalSeek}
            onTimeUpdate={handleOriginalTimeUpdate}
          />
          <AudioPlayer
            label="Processed"
            tag={processedPlaybackTag}
            detail={processedPlaybackDetail}
            src={processed?.outputUrl ?? null}
            audioRef={processedAudio}
            onPlay={handleProcessedPlay}
            onSeek={handleProcessedSeek}
            onTimeUpdate={handleProcessedTimeUpdate}
          />
        </div>
      </section>
    </main>
  );
}
