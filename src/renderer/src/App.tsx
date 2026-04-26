import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AudioWaveform,
  CheckCircle2,
  Circle,
  FileAudio,
  FolderOpen,
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
  lra: 11,
  outputSampleRate: 48000
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

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="field">
      <dt>{label}</dt>
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
  src,
  audioRef,
  onPlay
}: {
  label: string;
  src: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onPlay: () => void;
}) {
  return (
    <div className="player">
      <div className="player-label">{label}</div>
      <audio ref={audioRef} src={src ?? undefined} controls onPlay={onPlay} />
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
  const canExport = dependenciesReady && selected && processed && busy === 'idle';
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
        lra: settings.lra
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
    void discardCurrentPreview();
    setSettings((current) => ({ ...current, outputSampleRate }));
    setProcessed(null);
    setExportedPath(null);
  }

  function pauseProcessed() {
    processedAudio.current?.pause();
  }

  function pauseOriginal() {
    originalAudio.current?.pause();
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
        <StepPill label="Analyze" done={Boolean(analysis)} active={Boolean(selected && !analysis)} />
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
            <Field label="Codec" value={selected?.metadata.codecName ?? null} />
            <Field label="Sample rate" value={selected?.metadata.sampleRate ? `${selected.metadata.sampleRate} Hz` : null} />
            <Field label="Channels" value={selected?.metadata.channels ?? null} />
            <Field label="Layout" value={selected?.metadata.channelLayout ?? null} />
            <Field label="Bit depth" value={selected?.metadata.bitsPerSample ? `${selected.metadata.bitsPerSample}-bit` : null} />
            <Field label="Bit rate" value={selected ? formatBitRate(selected.metadata.bitRate) : null} />
            <Field label="File size" value={selected ? formatBytes(selected.metadata.fileSizeBytes) : null} />
          </dl>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div className="heading-title">
              <SlidersHorizontal size={20} />
              <h2>Output Settings</h2>
            </div>
            <span className="panel-badge ready">24-bit WAV</span>
          </div>
          <div className="segmented">
            <button
              className={settings.outputSampleRate === 48000 ? 'selected' : ''}
              onClick={() => updateSampleRate(48000)}
            >
              48 kHz / 24-bit WAV
            </button>
            <button
              className={settings.outputSampleRate === 96000 ? 'selected' : ''}
              onClick={() => updateSampleRate(96000)}
            >
              96 kHz / 24-bit WAV
            </button>
          </div>
          <div className="number-row">
            <label>
              Target LUFS
              <input type="number" step="0.1" value={settings.targetLUFS} onChange={(event) => updateNumberSetting('targetLUFS', event)} />
            </label>
            <label>
              True Peak
              <input type="number" step="0.1" value={settings.truePeak} onChange={(event) => updateNumberSetting('truePeak', event)} />
            </label>
            <label>
              LRA
              <input type="number" step="0.1" value={settings.lra} onChange={(event) => updateNumberSetting('lra', event)} />
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
            <Field label="Input Integrated LUFS" value={analysis?.input_i ?? null} />
            <Field label="Input True Peak" value={analysis?.input_tp ?? null} />
            <Field label="Input LRA" value={analysis?.input_lra ?? null} />
            <Field label="Input Threshold" value={analysis?.input_thresh ?? null} />
            <Field label="Target Offset" value={analysis?.target_offset ?? null} />
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
              <Field label="Output sample rate" value={processed.metadata.sampleRate ? `${processed.metadata.sampleRate} Hz` : null} />
              <Field label="Output bit depth" value={processed.metadata.bitsPerSample ? `${processed.metadata.bitsPerSample}-bit` : null} />
              <Field label="Output size" value={formatBytes(processed.metadata.fileSizeBytes)} />
            </dl>
          ) : null}
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
          <AudioPlayer label="Original" src={selected?.fileUrl ?? null} audioRef={originalAudio} onPlay={pauseProcessed} />
          <AudioPlayer label="Processed" src={processed?.outputUrl ?? null} audioRef={processedAudio} onPlay={pauseOriginal} />
        </div>
      </section>
    </main>
  );
}
