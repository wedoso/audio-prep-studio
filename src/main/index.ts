import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import electron from 'electron/main';
import {
  analyzeLoudness,
  AppError,
  checkDependencies,
  defaultOutputPath,
  exportAudioFile,
  processAudio,
  readMetadata,
  toAudioUrl,
  validateAudioPath
} from './ffmpeg';
import type { AppErrorPayload, LoudnessAnalysisResult, ProcessingSettings } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, dialog, ipcMain, protocol } = electron;

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

function audioContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  return 'audio/wav';
}

async function createAudioResponse(request: Request, filePath: string): Promise<Response> {
  const fileStats = await stat(filePath);
  const fileSize = fileStats.size;
  const range = request.headers.get('range');
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': audioContentType(filePath)
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${fileSize}`
        }
      });
    }

    const requestedStart = match[1] ? Number(match[1]) : 0;
    const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
    const start = Math.max(0, Math.min(requestedStart, fileSize - 1));
    const end = Math.max(start, Math.min(requestedEnd, fileSize - 1));
    const chunkSize = end - start + 1;

    return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`
      }
    });
  }

  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(fileSize)
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

    return createAudioResponse(request, filePath);
  });
}

async function getPreviewTempDir(): Promise<string> {
  const tempDir = path.join(app.getPath('temp'), 'music-fake-eq');
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function createPreviewOutputPath(inputPath: string): Promise<string> {
  const tempDir = await getPreviewTempDir();

  const sourceName = path.parse(inputPath).name.replace(/[^\w.-]+/g, '_');
  return path.join(tempDir, `${sourceName}_preview_${Date.now()}.wav`);
}

async function discardPreviewFile(filePath: string): Promise<void> {
  validateAudioPath(filePath);

  const tempDir = await getPreviewTempDir();
  const relativePath = path.relative(tempDir, filePath);
  const isInTempDir = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);

  if (!isInTempDir) {
    throw new AppError('Refusing to delete a file outside the preview temp folder.', filePath);
  }

  try {
    await unlink(filePath);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

async function cleanupPreviewTempDir(): Promise<void> {
  const tempDir = await getPreviewTempDir();
  let entries: string[];

  try {
    entries = await readdir(tempDir);
  } catch (error) {
    console.warn(`Could not read preview temp folder ${tempDir}: ${String(error)}`);
    return;
  }

  await Promise.allSettled(
    entries
      .filter((entry) => entry.endsWith('.wav'))
      .map(async (entry) => {
        const filePath = path.join(tempDir, entry);
        try {
          await discardPreviewFile(filePath);
        } catch (error) {
          console.warn(`Could not remove preview temp file ${filePath}: ${String(error)}`);
        }
      })
  );
}

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    title: 'Audio Prep Studio',
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
  async (
    payload: {
      filePath: string;
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
      >;
    }
  ) =>
    analyzeLoudness(payload.filePath, payload.settings)
);

handleIpc(
  'audio:process',
  async (
    payload: {
      filePath: string;
      settings: ProcessingSettings;
    }
  ) => {
    const previewPath = await createPreviewOutputPath(payload.filePath);
    const result = await processAudio(payload.filePath, previewPath, payload.settings);
    return {
      ...result,
      isPreview: true
    };
  }
);

handleIpc('audio:discard-preview', async (payload: { sourcePath: string }) => {
  await discardPreviewFile(payload.sourcePath);
  return null;
});

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

    const analysis = await analyzeLoudness(payload.originalPath, payload.settings);
    const result = await exportAudioFile(payload.originalPath, saveResult.filePath, payload.settings, analysis);

    try {
      await discardPreviewFile(payload.sourcePath);
    } catch (error) {
      console.warn(`Could not remove preview file ${payload.sourcePath}: ${String(error)}`);
    }

    return {
      ...result,
      analysis
    };
  }
);

app.whenReady().then(async () => {
  await cleanupPreviewTempDir();
  registerAudioProtocol();
  return createWindow();
});

app.on('before-quit', () => {
  void cleanupPreviewTempDir();
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
