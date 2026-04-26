export type AudioMetadata = {
  filePath: string;
  fileName: string;
  durationSeconds: number | null;
  codecName: string | null;
  codecType: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  bitRate: number | null;
  bitsPerSample: number | null;
  fileSizeBytes: number | null;
};

export type LoudnessAnalysisResult = {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
};

export type ProcessingSettings = {
  targetLUFS: number;
  truePeak: number;
  lra: number;
  outputSampleRate: 48000 | 96000;
};

export type ProcessResult = {
  outputPath: string;
  outputUrl: string;
  metadata: AudioMetadata;
};

export type ExportResult = ProcessResult;

export type DependencyStatus = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
};

export type AppErrorPayload = {
  message: string;
  details?: string;
};
