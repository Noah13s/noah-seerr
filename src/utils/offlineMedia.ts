import {
  copyOfflineFileToFolder,
  forgetOfflineEntryFolder,
  getOfflineEntryFolder,
  getOfflineFolder,
  hasFolderPermission,
  offlineDeviceFileName,
  rememberOfflineEntryFolder,
} from '@app/utils/offlineDevice';

export interface OfflineMediaEntry {
  id: string;
  title: string;
  kind: 'movie' | 'episode';
  mimeType: string;
  bytes: number;
  savedAt: string;
  storage?: 'device';
  deviceFileName?: string;
}

export const OFFLINE_PROFILE_KEY = 'noah-stream-offline-profile';

export interface OfflineDownload {
  profileId: number;
  id: string;
  title: string;
  kind: 'movie' | 'episode';
  progress: number;
  error?: string;
}

interface PendingDownload extends Omit<OfflineMediaEntry, 'bytes'> {
  profileId: number;
  itemId: string;
  expectedBytes: number;
  bytes: number;
  validator?: string;
}

const downloads = new Map<string, OfflineDownload>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const downloadKey = (profileId: number, id: string) => `${profileId}:${id}`;
const pendingPrefix = (profileId: number) => `noah-stream-offline-pending-${profileId}-`;
const pendingKey = (profileId: number, id: string) => `${pendingPrefix(profileId)}${id}`;
const notifyDownloads = () => listeners.forEach((listener) => listener());

const getPending = (profileId: number, id: string): PendingDownload | null => {
  try {
    const raw = localStorage.getItem(pendingKey(profileId, id));
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingDownload;
    return pending.profileId === profileId && pending.id === id &&
      /^[a-f0-9]{32}$/i.test(pending.itemId) &&
      Number.isSafeInteger(pending.expectedBytes) && pending.expectedBytes > 0 &&
      Number.isSafeInteger(pending.bytes) && pending.bytes >= 0 &&
      pending.bytes <= pending.expectedBytes &&
      (pending.kind === 'movie' || pending.kind === 'episode') &&
      ['video/mp4', 'video/webm', 'video/ogg'].includes(pending.mimeType)
      ? pending : null;
  } catch {
    return null;
  }
};

const setPending = (pending: PendingDownload) =>
  localStorage.setItem(pendingKey(pending.profileId, pending.id), JSON.stringify(pending));

const discardPartial = async (profileId: number, id: string) => {
  const pending = getPending(profileId, id);
  localStorage.removeItem(pendingKey(profileId, id));
  if (!pending || !navigator.storage?.getDirectory) return;
  const directory = await rootDirectory(profileId);
  await directory.removeEntry(fileName(pending)).catch(() => undefined);
};

export const subscribeOfflineDownloads = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const getOfflineDownloads = (profileId: number) =>
  [...downloads.values()].filter((download) => download.profileId === profileId);

export const cancelOfflineDownload = (profileId: number, id: string) => {
  const key = downloadKey(profileId, id);
  const controller = controllers.get(key);
  if (controller) controller.abort();
  else void discardPartial(profileId, id).catch(() => undefined).finally(() => {
    if (downloads.delete(key)) notifyDownloads();
  });
};

export const startOfflineDownload = async (options: Omit<Parameters<typeof saveOfflineMedia>[0], 'onProgress' | 'signal'>) => {
  const { profileId, itemId, kind, title } = options;
  const id = offlineFileId(kind, itemId);
  const key = downloadKey(profileId, id);
  if (controllers.has(key)) return;
  const pending = getPending(profileId, id);
  const controller = new AbortController();
  controllers.set(key, controller);
  downloads.set(key, {
    profileId, id, title, kind,
    progress: pending ? Math.floor((pending.bytes / pending.expectedBytes) * 100) : 0,
  });
  notifyDownloads();
  try {
    await saveOfflineMedia({
      ...options,
      signal: controller.signal,
      onProgress: (progress) => {
        const current = downloads.get(key);
        if (current && current.progress !== progress) {
          downloads.set(key, { ...current, progress });
          notifyDownloads();
        }
      },
    });
    downloads.delete(key);
  } catch (error) {
    if (controller.signal.aborted) {
      await discardPartial(profileId, id).catch(() => undefined);
      downloads.delete(key);
    } else {
      const saved = getPending(profileId, id);
      downloads.set(key, {
        profileId, id, title, kind,
        progress: saved ? Math.floor((saved.bytes / saved.expectedBytes) * 100) : 0,
        error: error instanceof Error ? error.message : 'Download failed.',
      });
    }
  } finally {
    controllers.delete(key);
    notifyDownloads();
  }
};

export const resumeOfflineDownload = (profileId: number, id: string) => {
  const pending = getPending(profileId, id);
  if (!pending) return;
  void startOfflineDownload({
    profileId,
    itemId: pending.itemId,
    kind: pending.kind,
    title: pending.title,
    confirmDownload: () => true,
  });
};

export const resumeOfflineDownloads = (profileId: number) => {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(pendingPrefix(profileId))) {
      resumeOfflineDownload(profileId, key.slice(pendingPrefix(profileId).length));
    }
  }
};

const rootDirectory = async (profileId: number) => {
  const root = await navigator.storage.getDirectory();
  const app = await root.getDirectoryHandle('noah-stream-offline', {
    create: true,
  });
  return app.getDirectoryHandle(`profile-${profileId}`, { create: true });
};

export const offlineFileId = (kind: 'movie' | 'episode', itemId: string) =>
  `${kind}-${itemId.replace(/[^a-zA-Z0-9-]/g, '')}`;

const fileName = (entry: Pick<OfflineMediaEntry, 'id' | 'mimeType'>) =>
  `${entry.id}.${entry.mimeType === 'video/webm' ? 'webm' : entry.mimeType === 'video/ogg' ? 'ogv' : 'mp4'}`;

export const readOfflineFile = async (
  profileId: number,
  entry: OfflineMediaEntry,
  deviceFolder?: FileSystemDirectoryHandle
) => {
  if (entry.storage === 'device') {
    const folder = deviceFolder ?? await getOfflineEntryFolder(profileId, entry.id);
    if (!folder || !entry.deviceFileName || !await hasFolderPermission(folder, 'read', true)) {
      throw new Error('Allow access to the saved video folder to play this file.');
    }
    return (await folder.getFileHandle(entry.deviceFileName)).getFile();
  }
  const directory = await rootDirectory(profileId);
  return (await directory.getFileHandle(fileName(entry))).getFile();
};

export const readOfflineEntries = async (profileId: number) => {
  const directory = await rootDirectory(profileId);
  try {
    const handle = await directory.getFileHandle('index.json');
    const text = await (await handle.getFile()).text();
    const parsed = JSON.parse(text) as OfflineMediaEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return [];
    throw error;
  }
};

const writeOfflineEntries = async (
  profileId: number,
  entries: OfflineMediaEntry[]
) => {
  const directory = await rootDirectory(profileId);
  const handle = await directory.getFileHandle('index.json', { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(entries));
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
};

export const removeOfflineMedia = async (profileId: number, id: string) => {
  const directory = await rootDirectory(profileId);
  const entries = await readOfflineEntries(profileId);
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  if (entry.storage === 'device') {
    const folder = await getOfflineEntryFolder(profileId, id);
    if (!folder || !entry.deviceFileName || !await hasFolderPermission(folder, 'readwrite')) {
      throw new Error('Allow access to the saved video folder to remove this file.');
    }
    await folder.removeEntry(entry.deviceFileName);
  } else {
    await directory.removeEntry(fileName(entry));
  }
  await writeOfflineEntries(
    profileId,
    entries.filter((entry) => entry.id !== id)
  );
  if (entry.storage === 'device') await forgetOfflineEntryFolder(profileId, id);
};

export const moveOfflineMediaToDevice = async (
  profileId: number,
  entry: OfflineMediaEntry,
  folder: FileSystemDirectoryHandle,
  onProgress?: (percent: number) => void
) => {
  if (entry.storage === 'device') return;
  if (!await hasFolderPermission(folder, 'readwrite')) {
    throw new Error('Allow access to the selected folder to move saved videos.');
  }
  const directory = await rootDirectory(profileId);
  const source = await (await directory.getFileHandle(fileName(entry))).getFile();
  if (source.size !== entry.bytes) throw new Error('The saved video is incomplete.');
  const deviceFileName = offlineDeviceFileName(profileId, entry.id, entry.title, entry.mimeType);
  await copyOfflineFileToFolder(source, folder, deviceFileName, onProgress);
  await rememberOfflineEntryFolder(profileId, entry.id, folder);
  const entries = await readOfflineEntries(profileId);
  await writeOfflineEntries(profileId, entries.map((item) =>
    item.id === entry.id ? { ...item, storage: 'device', deviceFileName } : item
  ));
  await directory.removeEntry(fileName(entry));
};

type WorkerReply = { requestId: number; bytes?: number; error?: string };

const createFileWriter = () => {
  const worker = new Worker('/offline-download-worker.js');
  let nextRequestId = 0;
  const request = (type: string, payload: Record<string, unknown> = {}) =>
    new Promise<number>((resolve, reject) => {
      const requestId = ++nextRequestId;
      const onMessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.requestId !== requestId) return;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.bytes ?? 0);
      };
      const onError = () => {
        cleanup();
        reject(new Error('Offline file writer is unavailable.'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ requestId, type, ...payload });
    });
  return { request, terminate: () => worker.terminate() };
};

export const saveOfflineMedia = async (options: {
  profileId: number;
  itemId: string;
  kind: 'movie' | 'episode';
  title: string;
  onProgress: (percent: number) => void;
  confirmDownload: (bytes: number, availableBytes: number) => boolean;
  signal: AbortSignal;
}) => {
  if (!navigator.storage?.getDirectory || typeof Worker === 'undefined') {
    throw new Error('Offline storage is not supported by this browser.');
  }
  const { profileId, itemId, kind, title, onProgress, confirmDownload, signal } = options;
  const id = offlineFileId(kind, itemId);
  let pending = getPending(profileId, id);
  const folder = await getOfflineFolder(profileId);
  if (!folder) throw new Error('Choose a device folder in the Offline Library before downloading.');
  if (!await hasFolderPermission(folder, 'readwrite')) {
    throw new Error('Allow access to your download folder in the Offline Library.');
  }
  const sessionResponse = await fetch('/api/v1/auth/jellyfin-session', {
    credentials: 'same-origin',
    signal,
  });
  if (!sessionResponse.ok) throw new Error('Jellyfin session is unavailable.');
  const session = (await sessionResponse.json()) as { accessToken: string };
  const url = `/player/Videos/${encodeURIComponent(itemId)}/stream.mp4?static=true`;
  let response: Response | null = null;
  let writer: ReturnType<typeof createFileWriter> | null = null;
  let writerOpen = false;
  try {
    if (!pending) {
      response = await fetch(url, {
        headers: { 'X-Emby-Token': session.accessToken },
        credentials: 'same-origin', signal,
      });
      if (!response.ok || !response.body) throw new Error('The media file could not be downloaded.');
      const mimeType = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['video/mp4', 'video/webm', 'video/ogg'].includes(mimeType) ||
          !document.createElement('video').canPlayType(mimeType)) {
        throw new Error('This source format cannot be played offline in this browser.');
      }
      const expectedBytes = Number(response.headers.get('content-length') ?? 0);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
        throw new Error('The server did not report the download size.');
      }
      const estimate = await navigator.storage.estimate();
      const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
      if (available < expectedBytes + 256 * 1024 * 1024) {
        throw new Error('Not enough device storage for this media.');
      }
      if (!confirmDownload(expectedBytes, available)) {
        throw new DOMException('Cancelled', 'AbortError');
      }
      pending = {
        profileId, id, itemId, title, kind, mimeType, expectedBytes,
        bytes: 0, savedAt: new Date().toISOString(),
        validator: (response.headers.get('etag')?.startsWith('W/')
          ? null : response.headers.get('etag')) ?? response.headers.get('last-modified') ?? undefined,
      };
      setPending(pending);
    }
    writer = createFileWriter();
    let bytes = await writer.request('open', { profileId, fileName: fileName(pending) });
    writerOpen = true;
    if (!Number.isSafeInteger(bytes) || bytes > pending.expectedBytes) {
      throw new Error('The partial download is invalid. Remove it and try again.');
    }
    if (bytes < pending.expectedBytes) {
      const estimate = await navigator.storage.estimate();
      const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
      if (available < pending.expectedBytes - bytes + 64 * 1024 * 1024) {
        throw new Error('Not enough device storage to finish this download.');
      }
    }
    pending.bytes = bytes;
    setPending(pending);
    onProgress(Math.floor((bytes / pending.expectedBytes) * 100));

    while (bytes < pending.expectedBytes) {
      const requestedFrom = bytes;
      if (!response) {
        const headers: Record<string, string> = {
          'X-Emby-Token': session.accessToken,
        };
        if (bytes > 0) {
          headers.Range = `bytes=${bytes}-`;
          if (pending.validator) headers['If-Range'] = pending.validator;
        }
        response = await fetch(url, { headers, credentials: 'same-origin', signal });
      }
      if (!response.ok || !response.body) throw new Error('The media file could not be downloaded.');
      let responseEnd = pending.expectedBytes - 1;
      if (requestedFrom > 0) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        if (response.status !== 206 || !range || Number(range[1]) !== requestedFrom ||
            Number(range[3]) !== pending.expectedBytes) {
          throw new Error('The server cannot resume this file. Remove the partial download and start again.');
        }
        responseEnd = Number(range[2]);
        if (responseEnd < requestedFrom || responseEnd >= pending.expectedBytes) {
          throw new Error('The server returned an invalid byte range.');
        }
      } else if (response.status !== 200) {
        throw new Error('The server returned an unexpected media response.');
      }
      const responseType = response.headers.get('content-type')?.split(';')[0];
      if (responseType && responseType !== pending.mimeType) {
        throw new Error('The media file changed during download. Remove the partial download and start again.');
      }
      const reader = response.body.getReader();
      let chunks: Uint8Array[] = [];
      let buffered = 0;
      const commit = async () => {
        if (!buffered) return;
        if (bytes + buffered > responseEnd + 1 || bytes + buffered > pending!.expectedBytes) {
          throw new Error('The server sent more data than expected.');
        }
        const combined = new Uint8Array(buffered);
        let position = 0;
        for (const chunk of chunks) {
          combined.set(chunk, position);
          position += chunk.byteLength;
        }
        const next = await writer!.request('write', { at: bytes, chunk: combined });
        if (next !== bytes + buffered || next > pending!.expectedBytes) {
          throw new Error('The offline file could not be verified.');
        }
        bytes = next;
        pending!.bytes = bytes;
        setPending(pending!);
        onProgress(Math.floor((bytes / pending!.expectedBytes) * 100));
        chunks = [];
        buffered = 0;
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          chunks.push(value);
          buffered += value.byteLength;
          if (buffered >= 1024 * 1024) await commit();
        }
        await commit();
      } finally {
        reader.releaseLock();
      }
      if (bytes !== responseEnd + 1) throw new Error('The download is incomplete.');
      response = null;
    }
    await writer.request('close');
    writerOpen = false;
    const entry: OfflineMediaEntry = {
      id, title: pending.title, kind: pending.kind, mimeType: pending.mimeType,
      bytes: pending.expectedBytes, savedAt: pending.savedAt,
    };
    const directory = await rootDirectory(profileId);
    const source = await (await directory.getFileHandle(fileName(entry))).getFile();
    if (source.size !== entry.bytes) throw new Error('The downloaded file is incomplete.');
    const deviceFileName = offlineDeviceFileName(profileId, id, entry.title, entry.mimeType);
    await copyOfflineFileToFolder(source, folder, deviceFileName, undefined, signal);
    await rememberOfflineEntryFolder(profileId, id, folder);
    entry.storage = 'device';
    entry.deviceFileName = deviceFileName;
    const entries = await readOfflineEntries(profileId);
    await writeOfflineEntries(profileId, [entry, ...entries.filter((previous) => previous.id !== id)]);
    await directory.removeEntry(fileName(entry));
    localStorage.removeItem(pendingKey(profileId, id));
    localStorage.setItem(OFFLINE_PROFILE_KEY, String(profileId));
    try { await navigator.storage.persist?.(); } catch { /* Completed copy remains usable. */ }
    return entry;
  } finally {
    await response?.body?.cancel().catch(() => undefined);
    if (writerOpen) await writer?.request('close').catch(() => undefined);
    writer?.terminate();
  }
};
