import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Activity, AudioWaveform, FileAudio, FolderOpen, Save, SlidersHorizontal } from 'lucide-react';
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

type BusyState = 'idle' | 'loading-file' | 'analyzing' | 'processing';

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
  const [busy, setBusy] = useState<BusyState>('idle');
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const originalAudio = useRef<HTMLAudioElement | null>(null);
  const processedAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    window.audioApp
      .checkDependencies()
      .then(setDeps)
      .catch((caught: Error) => setError({ message: 'Could not check FFmpeg dependencies.', details: caught.message }));
  }, []);

  const dependenciesReady = Boolean(deps?.ffmpeg && deps?.ffprobe);
  const canAnalyze = dependenciesReady && selected && busy === 'idle';
  const canProcess = canAnalyze && analysis;

  async function chooseFile() {
    setBusy('loading-file');
    setError(null);

    try {
      const result = await window.audioApp.chooseAudioFile();
      if (result) {
        setSelected(result);
        setAnalysis(null);
        setProcessed(null);
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
    setAnalysis(null);

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
    setProcessed(null);

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

  function updateNumberSetting(key: 'targetLUFS' | 'truePeak' | 'lra', event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setSettings((current) => ({ ...current, [key]: value }));
    setAnalysis(null);
    setProcessed(null);
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
        <div>
          <h1>Loudness Matcher</h1>
          <p>Analyze tracks with FFmpeg loudnorm and export 48 kHz or 96 kHz 24-bit WAV files.</p>
        </div>
        <div className={dependenciesReady ? 'status ok' : 'status warn'}>
          <Activity size={18} />
          {dependenciesReady ? 'FFmpeg ready' : 'FFmpeg missing'}
        </div>
      </header>

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
            <FileAudio size={20} />
            <h2>Input File</h2>
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
            <SlidersHorizontal size={20} />
            <h2>Output Settings</h2>
          </div>
          <div className="segmented">
            <button
              className={settings.outputSampleRate === 48000 ? 'selected' : ''}
              onClick={() => setSettings((current) => ({ ...current, outputSampleRate: 48000 }))}
            >
              48 kHz / 24-bit WAV
            </button>
            <button
              className={settings.outputSampleRate === 96000 ? 'selected' : ''}
              onClick={() => setSettings((current) => ({ ...current, outputSampleRate: 96000 }))}
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
            <AudioWaveform size={20} />
            <h2>Loudness Analysis</h2>
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
            <Save size={20} />
            <h2>Process / Export</h2>
          </div>
          <button className="primary-action" onClick={process} disabled={!canProcess}>
            <Save size={18} />
            {busy === 'processing' ? 'Processing...' : 'Process / Export WAV'}
          </button>
          <div className="path-line">{processed?.outputPath ?? 'No processed file yet'}</div>
          {processed ? (
            <dl className="metadata-grid compact">
              <Field label="Output codec" value={processed.metadata.codecName} />
              <Field label="Output sample rate" value={processed.metadata.sampleRate ? `${processed.metadata.sampleRate} Hz` : null} />
              <Field label="Output bit depth" value={processed.metadata.bitsPerSample ? `${processed.metadata.bitsPerSample}-bit` : null} />
              <Field label="Output size" value={formatBytes(processed.metadata.fileSizeBytes)} />
            </dl>
          ) : null}
        </section>
      </div>

      <section className="panel playback-panel">
        <h2>Playback</h2>
        <div className="players">
          <AudioPlayer label="Original" src={selected?.fileUrl ?? null} audioRef={originalAudio} onPlay={pauseProcessed} />
          <AudioPlayer label="Processed" src={processed?.outputUrl ?? null} audioRef={processedAudio} onPlay={pauseOriginal} />
        </div>
      </section>
    </main>
  );
}
