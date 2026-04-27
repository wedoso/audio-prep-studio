import { execFile, spawn } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  AudioMetadata,
  DependencyStatus,
  LoudnessAnalysisResult,
  ProcessingSettings,
  ProcessResult
} from './types';

const REQUIRED_LOUDNORM_FIELDS: Array<keyof LoudnessAnalysisResult> = [
  'input_i',
  'input_tp',
  'input_lra',
  'input_thresh',
  'target_offset'
];

const AFFTDN_NOISE_FLOOR_MIN = -80;
const AFFTDN_NOISE_FLOOR_MAX = -20;

type CommandResult = {
  stdout: string;
  stderr: string;
};

type ProgressReporter = (percent: number) => void;

export class AppError extends Error {
  details?: string;

  constructor(message: string, details?: string) {
    super(message);
    this.name = 'AppError';
    this.details = details;
  }
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
      if (error) {
        reject(new AppError(`${command} failed.`, `${stderr || stdout || error.message}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function progressArgs(args: string[]): string[] {
  if (args[0] === '-hide_banner') {
    return ['-hide_banner', '-nostats', '-progress', 'pipe:2', ...args.slice(1)];
  }
  return ['-nostats', '-progress', 'pipe:2', ...args];
}

function runCommandWithProgress(
  command: string,
  args: string[],
  durationSeconds: number | null,
  onProgress?: ProgressReporter
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, progressArgs(args), { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stderrBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBuffer += chunk.toString('utf8');
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'out_time_ms' && durationSeconds && durationSeconds > 0) {
          const elapsedSeconds = Number(value) / 1_000_000;
          if (Number.isFinite(elapsedSeconds)) {
            onProgress?.(Math.min(0.99, Math.max(0, elapsedSeconds / durationSeconds)));
          }
        } else if (key === 'progress' && value === 'end') {
          onProgress?.(1);
        }
      }
    });

    child.on('error', (error) => {
      reject(new AppError(`${command} failed.`, error.message));
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code !== 0) {
        reject(new AppError(`${command} failed.`, `${stderr || stdout || `Exited with code ${code}`}`));
        return;
      }

      onProgress?.(1);
      resolve({ stdout, stderr });
    });
  });
}

async function commandVersion(command: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
  try {
    const { stdout } = await runCommand(command, ['-version']);
    return stdout.split('\n')[0] || null;
  } catch {
    return null;
  }
}

export async function checkDependencies(): Promise<DependencyStatus> {
  const [ffmpegVersion, ffprobeVersion] = await Promise.all([
    commandVersion('ffmpeg'),
    commandVersion('ffprobe')
  ]);

  return {
    ffmpeg: Boolean(ffmpegVersion),
    ffprobe: Boolean(ffprobeVersion),
    ffmpegVersion,
    ffprobeVersion
  };
}

export function validateAudioPath(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.wav' && ext !== '.mp3') {
    throw new AppError('Unsupported file type. Choose a WAV or MP3 file.');
  }
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === 'N/A') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function readMetadata(filePath: string): Promise<AudioMetadata> {
  validateAudioPath(filePath);

  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new AppError('The selected file cannot be read.');
  }

  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size,bit_rate',
    '-show_entries',
    'stream=codec_name,codec_type,sample_rate,channels,channel_layout,bits_per_sample,bits_per_raw_sample,bit_rate',
    '-of',
    'json',
    filePath
  ];

  let parsed: {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  try {
    const { stdout } = await runCommand('ffprobe', args);
    parsed = JSON.parse(stdout);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError('FFprobe could not inspect this file.', error.details);
    }
    throw new AppError('FFprobe returned invalid metadata JSON.', String(error));
  }

  const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio') ?? parsed.streams?.[0];
  if (!audioStream) {
    throw new AppError('No audio stream was found in the selected file.');
  }

  const fileStats = await stat(filePath);
  const bitsPerSample =
    parseNullableNumber(audioStream.bits_per_sample) ?? parseNullableNumber(audioStream.bits_per_raw_sample);

  return {
    filePath,
    fileName: path.basename(filePath),
    durationSeconds: parseNullableNumber(parsed.format?.duration),
    codecName: typeof audioStream.codec_name === 'string' ? audioStream.codec_name : null,
    codecType: typeof audioStream.codec_type === 'string' ? audioStream.codec_type : null,
    sampleRate: parseNullableNumber(audioStream.sample_rate),
    channels: parseNullableNumber(audioStream.channels),
    channelLayout: typeof audioStream.channel_layout === 'string' ? audioStream.channel_layout : null,
    bitRate: parseNullableNumber(audioStream.bit_rate) ?? parseNullableNumber(parsed.format?.bit_rate),
    bitsPerSample,
    fileSizeBytes: parseNullableNumber(parsed.format?.size) ?? fileStats.size
  };
}

function extractJsonObject(stderr: string): Record<string, unknown> {
  const firstBrace = stderr.indexOf('{');
  const lastBrace = stderr.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new AppError('Could not find loudness JSON in FFmpeg output.', stderr);
  }

  const jsonText = stderr.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new AppError('Could not parse loudness JSON from FFmpeg.', `${String(error)}\n\n${stderr}`);
  }
}

function validateAnalysis(result: Record<string, unknown>): LoudnessAnalysisResult {
  const missing = REQUIRED_LOUDNORM_FIELDS.filter((field) => typeof result[field] !== 'string');
  if (missing.length > 0) {
    throw new AppError(`Loudness analysis is missing required fields: ${missing.join(', ')}.`);
  }

  return {
    input_i: result.input_i as string,
    input_tp: result.input_tp as string,
    input_lra: result.input_lra as string,
    input_thresh: result.input_thresh as string,
    target_offset: result.target_offset as string
  };
}

export async function analyzeLoudness(
  filePath: string,
  settings: Pick<
    ProcessingSettings,
    | 'targetLUFS'
    | 'truePeak'
    | 'lra'
    | 'denoiseEnabled'
    | 'denoiseFftEnabled'
    | 'denoiseNoiseFloor'
    | 'denoiseHighpassEnabled'
    | 'denoiseHighpassHz'
    | 'denoiseLowpassEnabled'
    | 'denoiseLowpassHz'
    | 'deEsserEnabled'
    | 'deEsserPreset'
  >
): Promise<LoudnessAnalysisResult> {
  validateAudioPath(filePath);

  const filter = buildFilterChain(settings, {
    includeLoudnormPrint: true
  });
  const args = ['-hide_banner', '-i', filePath, '-af', filter, '-f', 'null', '-'];

  try {
    const { stderr } = await runCommand('ffmpeg', args);
    return validateAnalysis(extractJsonObject(stderr));
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError('Loudness analysis failed.', error.details ?? error.message);
    }
    throw error;
  }
}

function buildPreprocessingFilters(
  settings: Pick<
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
  >
): string[] {
  const filters: string[] = [];

  if (settings.denoiseEnabled) {
    if (settings.denoiseFftEnabled) {
      if (
        settings.denoiseNoiseFloor < AFFTDN_NOISE_FLOOR_MIN ||
        settings.denoiseNoiseFloor > AFFTDN_NOISE_FLOOR_MAX
      ) {
        throw new AppError(
          'Invalid FFT denoise noise floor.',
          `FFmpeg afftdn requires noise floor between ${AFFTDN_NOISE_FLOOR_MIN} and ${AFFTDN_NOISE_FLOOR_MAX} dB. Current value: ${settings.denoiseNoiseFloor}.`
        );
      }
      filters.push(`afftdn=nf=${settings.denoiseNoiseFloor}`);
    }
    if (settings.denoiseHighpassEnabled) {
      filters.push(`highpass=f=${settings.denoiseHighpassHz}`);
    }
    if (settings.denoiseLowpassEnabled) {
      filters.push(`lowpass=f=${settings.denoiseLowpassHz}`);
    }
  }

  if (settings.deEsserEnabled) {
    const presets = {
      light: [
        'equalizer=f=6200:t=q:w=2.2:g=-2',
        'equalizer=f=9000:t=q:w=2.5:g=-1'
      ],
      medium: [
        'equalizer=f=6200:t=q:w=2.2:g=-3',
        'equalizer=f=9000:t=q:w=2.5:g=-2'
      ],
      aggressive: [
        'equalizer=f=6200:t=q:w=2.2:g=-4.5',
        'equalizer=f=9000:t=q:w=2.5:g=-3'
      ]
    };

    filters.push(...presets[settings.deEsserPreset]);
  }

  return filters;
}

function buildAnalysisLoudnormFilter(settings: Pick<ProcessingSettings, 'targetLUFS' | 'truePeak' | 'lra'>): string {
  return `loudnorm=I=${settings.targetLUFS}:TP=${settings.truePeak}:LRA=${settings.lra}:print_format=json`;
}

function buildSecondPassLoudnormFilter(
  settings: Pick<ProcessingSettings, 'targetLUFS' | 'truePeak' | 'lra'>,
  analysis: LoudnessAnalysisResult
): string {
  return [
    `loudnorm=I=${settings.targetLUFS}`,
    `TP=${settings.truePeak}`,
    `LRA=${settings.lra}`,
    `measured_I=${analysis.input_i}`,
    `measured_TP=${analysis.input_tp}`,
    `measured_LRA=${analysis.input_lra}`,
    `measured_thresh=${analysis.input_thresh}`,
    `offset=${analysis.target_offset}`,
    'linear=true'
  ].join(':');
}

function buildFilterChain(
  settings: Pick<
    ProcessingSettings,
    | 'targetLUFS'
    | 'truePeak'
    | 'lra'
    | 'denoiseEnabled'
    | 'denoiseFftEnabled'
    | 'denoiseNoiseFloor'
    | 'denoiseHighpassEnabled'
    | 'denoiseHighpassHz'
    | 'denoiseLowpassEnabled'
    | 'denoiseLowpassHz'
    | 'deEsserEnabled'
    | 'deEsserPreset'
  >,
  options:
    | {
        includeLoudnormPrint: true;
      }
    | {
        includeLoudnormPrint: false;
        analysis: LoudnessAnalysisResult;
      }
): string {
  const filters = buildPreprocessingFilters(settings);
  filters.push(
    options.includeLoudnormPrint
      ? buildAnalysisLoudnormFilter(settings)
      : buildSecondPassLoudnormFilter(settings, options.analysis)
  );
  return filters.join(',');
}

export function defaultOutputPath(inputPath: string, sampleRate: 48000 | 96000): string {
  const suffix = sampleRate === 48000 ? '48k24' : '96k24';
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}_prepared_${suffix}.wav`);
}

export async function processAudio(
  filePath: string,
  outputPath: string,
  settings: ProcessingSettings,
  onProgress?: (percent: number, message: string) => void
): Promise<ProcessResult> {
  validateAudioPath(filePath);
  const inputMetadata = await readMetadata(filePath);

  let analysis: LoudnessAnalysisResult | null = null;
  let filters = buildPreprocessingFilters(settings);

  if (settings.loudnessEnabled) {
    onProgress?.(0.05, 'Analyzing loudness');
    analysis = await analyzeLoudness(filePath, settings);
    onProgress?.(0.4, 'Applying loudness match');
    filters = [
      buildFilterChain(settings, {
        includeLoudnormPrint: false,
        analysis
      })
    ];
  }
  const args = [
    '-hide_banner',
    '-y',
    '-i',
    filePath,
    '-c:a',
    'pcm_s24le',
    outputPath
  ];

  if (filters.length > 0) {
    args.splice(4, 0, '-af', filters.join(','));
  }

  try {
    const start = settings.loudnessEnabled ? 0.4 : 0;
    const span = settings.loudnessEnabled ? 0.6 : 1;
    await runCommandWithProgress('ffmpeg', args, inputMetadata.durationSeconds, (percent) => {
      onProgress?.(start + percent * span, 'Rendering preview');
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError('Processing command failed.', error.details);
    }
    throw error;
  }

  const outputStats = await stat(outputPath);
  if (outputStats.size <= 0) {
    throw new AppError('Processed output was created but appears to be empty.');
  }

  const metadata = await readMetadata(outputPath);
  if (metadata.codecName !== 'pcm_s24le') {
    throw new AppError(
      'Processed preview did not match the expected WAV settings.',
      `Expected pcm_s24le, got ${metadata.codecName ?? 'unknown'}.`
    );
  }

  return {
    outputPath,
    outputUrl: toAudioUrl(outputPath),
    metadata,
    isPreview: false,
    analysis
  };
}

export async function exportAudioFile(
  sourcePath: string,
  outputPath: string,
  sampleRate: 48000 | 96000,
  onProgress?: (percent: number, message: string) => void
): Promise<ProcessResult> {
  validateAudioPath(sourcePath);
  const sourceMetadata = await readMetadata(sourcePath);

  const args = [
    '-hide_banner',
    '-y',
    '-i',
    sourcePath,
    '-ar',
    String(sampleRate),
    '-c:a',
    'pcm_s24le',
    outputPath
  ];

  try {
    await runCommandWithProgress('ffmpeg', args, sourceMetadata.durationSeconds, (percent) => {
      onProgress?.(percent, 'Writing export');
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError('Export conversion failed.', error.details);
    }
    throw error;
  }

  const outputStats = await stat(outputPath);
  if (outputStats.size <= 0) {
    throw new AppError('Exported output was created but appears to be empty.');
  }

  const metadata = await readMetadata(outputPath);
  if (metadata.codecName !== 'pcm_s24le' || metadata.sampleRate !== sampleRate) {
    throw new AppError(
      'Exported output did not match the requested WAV settings.',
      `Expected pcm_s24le at ${sampleRate} Hz, got ${metadata.codecName ?? 'unknown'} at ${
        metadata.sampleRate ?? 'unknown'
      } Hz.`
    );
  }

  return {
    outputPath,
    outputUrl: toAudioUrl(outputPath),
    metadata,
    isPreview: false
  };
}

export function toAudioUrl(filePath: string): string {
  const encodedPath = Buffer.from(filePath, 'utf8').toString('base64url');
  return `app-audio://file/${encodedPath}`;
}
