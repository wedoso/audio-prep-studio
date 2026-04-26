import { contextBridge, ipcRenderer } from 'electron';
import type {
  AudioMetadata,
  DependencyStatus,
  ExportResult,
  LoudnessAnalysisResult,
  ProcessingSettings,
  ProcessResult
} from '../main/types';

type SelectedFile = {
  metadata: AudioMetadata;
  fileUrl: string;
};

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { message: string; details?: string } };

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>;
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.stack = result.error.details;
    throw error;
  }

  return result.data;
}

const api = {
  checkDependencies: (): Promise<DependencyStatus> => invoke('deps:check'),
  chooseAudioFile: (): Promise<SelectedFile | null> => invoke('file:choose'),
  analyzeLoudness: (
    filePath: string,
    settings: Pick<ProcessingSettings, 'targetLUFS' | 'truePeak' | 'lra'>
  ): Promise<LoudnessAnalysisResult> => invoke('audio:analyze', { filePath, settings }),
  processAudio: (
    filePath: string,
    settings: ProcessingSettings,
    analysis: LoudnessAnalysisResult
  ): Promise<ProcessResult> => invoke('audio:process', { filePath, settings, analysis }),
  discardPreview: (sourcePath: string): Promise<null> => invoke('audio:discard-preview', { sourcePath }),
  exportAudio: (sourcePath: string, originalPath: string, settings: ProcessingSettings): Promise<ExportResult> =>
    invoke('audio:export', { sourcePath, originalPath, settings })
};

contextBridge.exposeInMainWorld('audioApp', api);

export type AudioAppApi = typeof api;
