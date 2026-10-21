type PermissionMode = 'read' | 'readwrite';
type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission: (options: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission: (options: { mode: PermissionMode }) => Promise<PermissionState>;
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('noah-stream-device-files', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('folders');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readFolder = async (key: string) => {
  const database = await openDatabase();
  return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const transaction = database.transaction('folders', 'readonly');
    const request = transaction.objectStore('folders').get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
};

const writeFolder = async (key: string, folder: FileSystemDirectoryHandle | null) => {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('folders', 'readwrite');
    const store = transaction.objectStore('folders');
    if (folder) store.put(folder, key);
    else store.delete(key);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
};

const defaultKey = (profileId: number) => `profile-${profileId}:default`;
const entryKey = (profileId: number, id: string) => `profile-${profileId}:${id}`;

export const canChooseOfflineFolder = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;

export const getOfflineFolder = (profileId: number) => readFolder(defaultKey(profileId));

export const chooseOfflineFolder = async (profileId: number) => {
  const picker = (window as Window & {
    showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) throw new Error('This browser cannot choose a device folder.');
  // The picker must be opened directly from the user's click.
  const folder = await picker.call(window, {
    id: `noah-stream-profile-${profileId}`,
    mode: 'readwrite',
  });
  await writeFolder(defaultKey(profileId), folder);
  return folder;
};

export const getOfflineEntryFolder = (profileId: number, id: string) =>
  readFolder(entryKey(profileId, id));

export const rememberOfflineEntryFolder = (profileId: number, id: string, folder: FileSystemDirectoryHandle) =>
  writeFolder(entryKey(profileId, id), folder);

export const forgetOfflineEntryFolder = (profileId: number, id: string) =>
  writeFolder(entryKey(profileId, id), null);

export const hasFolderPermission = async (
  folder: FileSystemDirectoryHandle,
  mode: PermissionMode,
  prompt = false
) => {
  const handle = folder as PermissionHandle;
  if (!handle.queryPermission || !handle.requestPermission) return false;
  return (prompt
    ? await handle.requestPermission({ mode })
    : await handle.queryPermission({ mode })) === 'granted';
};

export const offlineDeviceFileName = (profileId: number, id: string, title: string, mimeType: string) => {
  const safeTitle = [...title].map((character) =>
    character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? ' ' : character
  ).join('').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Video';
  const extension = mimeType === 'video/webm' ? 'webm' : mimeType === 'video/ogg' ? 'ogv' : 'mp4';
  return `NoahStream-${profileId}-${id}-${safeTitle}.${extension}`;
};

export const copyOfflineFileToFolder = async (
  source: File,
  folder: FileSystemDirectoryHandle,
  name: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
) => {
  const handle = await folder.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const reader = source.stream().getReader();
  let bytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await writable.write(value);
      bytes += value.byteLength;
      onProgress?.(Math.floor((bytes / source.size) * 100));
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if ((await handle.getFile()).size !== source.size) {
    throw new Error('The device copy could not be verified.');
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};
