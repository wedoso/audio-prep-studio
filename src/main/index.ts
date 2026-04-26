import { copyFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electron from 'electron/main';
import {
  analyzeLoudness,
  AppError,
  checkDependencies,
  defaultOutputPath,
  processAudio,
  readMetadata,
  toAudioUrl,
  validateAudioPath
} from './ffmpeg';
import type { AppErrorPayload, LoudnessAnalysisResult, ProcessingSettings } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, dialog, ipcMain, net, protocol } = electron;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-audio',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload };

function serializeError(error: unknown): AppErrorPayload {
  if (error instanceof AppError) {
    return { message: error.message, details: error.details };
  }

  if (error instanceof Error) {
    return { message: error.message, details: error.stack };
  }

  return { message: 'An unknown error occurred.', details: String(error) };
}

function handleIpc<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (...args: TArgs) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (_event, ...args: TArgs): Promise<IpcResult<TResult>> => {
    try {
      return { ok: true, data: await listener(...args) };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  });
}

function registerAudioProtocol(): void {
  protocol.handle('app-audio', async (request) => {
    const url = new URL(request.url);
    const encodedPath = url.pathname.replace(/^\//, '');

    if (url.hostname !== 'file' || !encodedPath) {
      return new Response('Invalid audio URL.', { status: 400 });
    }

    const filePath = Buffer.from(encodedPath, 'base64url').toString('utf8');
    validateAudioPath(filePath);

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

async function createPreviewOutputPath(inputPath: string, sampleRate: 48000 | 96000): Promise<string> {
  const tempDir = path.join(app.getPath('temp'), 'music-fake-eq');
  await mkdir(tempDir, { recursive: true });

  const suffix = sampleRate === 48000 ? '48k24' : '96k24';
  const sourceName = path.parse(inputPath).name.replace(/[^\w.-]+/g, '_');
  return path.join(tempDir, `${sourceName}_matched_${suffix}_${Date.now()}.wav`);
}

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    title: 'Loudness Matcher',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('console-message', (details) => {
    console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedUrl}`);
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[preload:error] ${preloadPath}: ${error.message}`);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

handleIpc('deps:check', async () => checkDependencies());

handleIpc('file:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose Audio File',
    properties: ['openFile'],
    filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  return {
    metadata: await readMetadata(filePath),
    fileUrl: toAudioUrl(filePath)
  };
});

handleIpc(
  'audio:analyze',
  async (payload: { filePath: string; settings: Pick<ProcessingSettings, 'targetLUFS' | 'truePeak' | 'lra'> }) =>
    analyzeLoudness(payload.filePath, payload.settings)
);

handleIpc(
  'audio:process',
  async (
    payload: {
      filePath: string;
      settings: ProcessingSettings;
      analysis: LoudnessAnalysisResult;
    }
  ) => {
    const previewPath = await createPreviewOutputPath(payload.filePath, payload.settings.outputSampleRate);
    return processAudio(payload.filePath, previewPath, payload.settings, payload.analysis);
  }
);

handleIpc(
  'audio:export',
  async (
    payload: {
      sourcePath: string;
      originalPath: string;
      settings: ProcessingSettings;
    }
  ) => {
    validateAudioPath(payload.sourcePath);

    const suggestedPath = defaultOutputPath(payload.originalPath, payload.settings.outputSampleRate);
    const saveResult = await dialog.showSaveDialog({
      title: 'Export Matched WAV',
      defaultPath: suggestedPath,
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    });

    if (saveResult.canceled || !saveResult.filePath) {
      throw new AppError('Export was canceled.');
    }

    await copyFile(payload.sourcePath, saveResult.filePath);

    try {
      await unlink(payload.sourcePath);
    } catch (error) {
      console.warn(`Could not remove preview file ${payload.sourcePath}: ${String(error)}`);
    }

    return {
      outputPath: saveResult.filePath,
      outputUrl: toAudioUrl(saveResult.filePath),
      metadata: await readMetadata(saveResult.filePath)
    };
  }
);

app.whenReady().then(() => {
  registerAudioProtocol();
  return createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
